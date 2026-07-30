// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Este test crea usuarios/orgs reales vía signUp()/RPCs. Solo debe correr
// contra la instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `permissions.test.ts (requests) apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
  );
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

type TestTenant = { client: SupabaseClient; userId: string; email: string };

function newAnonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// service_role bypassa RLS por completo — se usa solo para las
// aserciones de idempotencia (bloque 3.1b) que necesitan intentar un insert
// directo en `notifications`, algo que ningún cliente autenticado normal
// puede hacer (RLS lo bloquea con with check(false)). Nombre distinto de la
// `admin: TestTenant` (org_admin real de la org, ya usada en este archivo)
// para no colisionar.
const serviceRole: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function signUpOrg(label: string): Promise<TestTenant> {
  const client = newAnonClient();
  const suffix = randomSuffix();
  const email = `${label}-${suffix}@example.test`;

  const { data, error } = await client.auth.signUp({
    email,
    password: "Test1234!",
    options: {
      data: {
        full_name: `${label} Owner`,
        org_name: `${label} Inc`,
        org_slug: `${label}-${suffix}`,
        default_currency: "EUR",
        locale: "es",
      },
    },
  });

  if (error || !data.user) {
    throw error ?? new Error("signUp did not return a user");
  }

  return { client, userId: data.user.id, email };
}

async function inviteAndAccept(orgAdmin: TestTenant, role: string, label: string): Promise<TestTenant> {
  const suffix = randomSuffix();
  const email = `${label}-${suffix}@example.test`;
  const tokenHash = `${label}-${suffix}`.padEnd(64, "0");

  const { error: inviteError } = await orgAdmin.client.rpc("create_invitation", {
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
    p_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (inviteError) throw inviteError;

  const client = newAnonClient();
  const { data, error } = await client.auth.signUp({
    email,
    password: "Test1234!",
    options: { data: { full_name: `${label} User`, invitation_token_hash: tokenHash } },
  });

  if (error || !data.user) {
    throw error ?? new Error("signUp did not return a user");
  }

  return { client, userId: data.user.id, email };
}

async function publicUserId(tenant: TestTenant): Promise<string> {
  const { data, error } = await tenant.client
    .from("users")
    .select("id")
    .eq("auth_id", tenant.userId)
    .single();
  if (error || !data) throw error ?? new Error("public user row not found");
  return data.id as string;
}

function createRequestParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    p_catalog_id: null,
    p_vendor_name: "Notion",
    p_estimated_annual_cost: 1200,
    p_currency: "EUR",
    p_department_id: null,
    p_justification: "Necesitamos documentación centralizada para el equipo.",
    p_alternatives_considered: "Confluence, Google Docs",
    ...overrides,
  };
}

describe("Permisos de purchase_requests (bloque 3.1)", () => {
  let admin: TestTenant;
  let employeeA: TestTenant;
  let employeeB: TestTenant;
  let finance: TestTenant;
  let manager: TestTenant;
  let otherOrgAdmin: TestTenant;

  beforeAll(async () => {
    admin = await signUpOrg("req-admin");

    [employeeA, employeeB, finance, manager] = await Promise.all([
      inviteAndAccept(admin, "employee", "req-empA"),
      inviteAndAccept(admin, "employee", "req-empB"),
      inviteAndAccept(admin, "finance", "req-finance"),
      inviteAndAccept(admin, "manager", "req-manager"),
    ]);

    otherOrgAdmin = await signUpOrg("req-other");
  });

  it("un empleado crea una solicitud y la ve; ningún otro usuario (mismo org u otro) la ve", async () => {
    const { data: requestId, error: createError } = await employeeA.client.rpc(
      "create_purchase_request",
      createRequestParams(),
    );
    expect(createError).toBeNull();
    expect(requestId).toBeTruthy();

    const { data: ownRows, error: ownError } = await employeeA.client
      .from("purchase_requests")
      .select("id")
      .eq("id", requestId);
    expect(ownError).toBeNull();
    expect(ownRows).toHaveLength(1);

    const { data: otherEmployeeRows, error: otherEmployeeError } = await employeeB.client
      .from("purchase_requests")
      .select("id")
      .eq("id", requestId);
    expect(otherEmployeeError).toBeNull();
    expect(otherEmployeeRows).toHaveLength(0);

    const { data: otherOrgRows, error: otherOrgError } = await otherOrgAdmin.client
      .from("purchase_requests")
      .select("id")
      .eq("id", requestId);
    expect(otherOrgError).toBeNull();
    expect(otherOrgRows).toHaveLength(0);
  });

  it.each([
    ["finance", () => finance],
    ["manager", () => manager],
    ["org_admin", () => admin],
  ])("%s también puede crear una solicitud (el RPC no está gateado por rol)", async (_role, getTenant) => {
    const { data, error } = await getTenant().client.rpc("create_purchase_request", createRequestParams());
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("insert/update/delete directos contra la tabla están bloqueados por RLS", async () => {
    const { data: requestId } = await employeeA.client.rpc("create_purchase_request", createRequestParams());
    const employeeAId = await publicUserId(employeeA);

    const { error: insertError } = await employeeA.client.from("purchase_requests").insert({
      org_id: employeeAId,
      requester_id: employeeAId,
      vendor_name: "Direct insert attempt",
      estimated_annual_cost: 1,
      currency: "EUR",
      justification: "x",
    });
    expect(insertError).not.toBeNull();

    const { error: updateError } = await employeeA.client
      .from("purchase_requests")
      .update({ status: "approved" })
      .eq("id", requestId);
    expect(updateError).toBeNull(); // RLS using(false) matches 0 rows silently, not an error...
    const { data: unchanged } = await employeeA.client
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(unchanged?.status).toBe("pending"); // ...so the real assertion is that nothing changed.

    const { error: deleteError } = await employeeA.client.from("purchase_requests").delete().eq("id", requestId);
    expect(deleteError).toBeNull();
    const { data: stillThere } = await employeeA.client
      .from("purchase_requests")
      .select("id")
      .eq("id", requestId);
    expect(stillThere).toHaveLength(1);
  });

  it("department_id nulo cae al departamento propio del empleado", async () => {
    const { data: departmentId, error: deptError } = await admin.client.rpc("create_department", {
      p_name: `Ingeniería ${randomSuffix()}`,
      p_manager_user_id: null,
    });
    expect(deptError).toBeNull();

    const employeeAId = await publicUserId(employeeA);
    const { error: assignError } = await admin.client.rpc("update_user_department", {
      p_user_id: employeeAId,
      p_department_id: departmentId,
    });
    expect(assignError).toBeNull();

    const { data: requestId, error: createError } = await employeeA.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_department_id: null }),
    );
    expect(createError).toBeNull();

    const { data: request, error: fetchError } = await employeeA.client
      .from("purchase_requests")
      .select("department_id")
      .eq("id", requestId)
      .single();
    expect(fetchError).toBeNull();
    expect(request?.department_id).toBe(departmentId);
  });
});

describe("Ciclo de aprobación de purchase_requests vía el motor (bloque 3.2a)", () => {
  // Reemplaza el ciclo de un solo nivel de 3.1b (resolve_purchase_request
  // gateado a finance/org_admin en bloque) por el motor real: el aprobador
  // autorizado es el resuelto en purchase_request_steps para el paso activo
  // (aquí, el manager real del departamento — tier 500-5000, sin fallback).
  let admin: TestTenant;
  let employeeA: TestTenant;
  let employeeB: TestTenant;
  let finance: TestTenant;
  let manager: TestTenant;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("appr-admin");

    [employeeA, employeeB, finance, manager] = await Promise.all([
      inviteAndAccept(admin, "employee", "appr-empA"),
      inviteAndAccept(admin, "employee", "appr-empB"),
      inviteAndAccept(admin, "finance", "appr-finance"),
      inviteAndAccept(admin, "manager", "appr-manager"),
    ]);

    const managerId = await publicUserId(manager);
    const { data: deptId, error: deptError } = await admin.client.rpc("create_department", {
      p_name: `Approval Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    expect(deptError).toBeNull();
    departmentId = deptId as string;

    const employeeAId = await publicUserId(employeeA);
    const { error: assignError } = await admin.client.rpc("update_user_department", {
      p_user_id: employeeAId,
      p_department_id: departmentId,
    });
    expect(assignError).toBeNull();
  });

  async function createRequest(overrides: Partial<Record<string, unknown>> = {}) {
    // 1200 EUR + departamento con manager real -> tier 500-5000, 1 paso,
    // resuelto directamente al manager (sin fallback_no_manager).
    const { data: requestId, error } = await employeeA.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_department_id: departmentId, ...overrides }),
    );
    expect(error).toBeNull();
    return requestId as string;
  }

  it("al crear la solicitud, el manager real recibe 'purchase_request_step_pending'; finance no (no es su paso)", async () => {
    const requestId = await createRequest();
    const managerId = await publicUserId(manager);
    const financeId = await publicUserId(finance);

    const { data: managerNotifs } = await manager.client
      .from("notifications")
      .select("id, type, payload, step_order")
      .eq("request_id", requestId)
      .eq("user_id", managerId)
      .eq("type", "purchase_request_step_pending");
    expect(managerNotifs).toHaveLength(1);
    expect(managerNotifs?.[0]?.step_order).toBe(1);
    expect(managerNotifs?.[0]?.payload).toMatchObject({ vendor_name: "Notion" });

    const { data: financeNotifs } = await finance.client
      .from("notifications")
      .select("id")
      .eq("request_id", requestId)
      .eq("user_id", financeId);
    expect(financeNotifs).toHaveLength(0);
  });

  it("el manager real aprueba; el solicitante recibe 'purchase_request_resolved'", async () => {
    const requestId = await createRequest();

    const { error } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(error).toBeNull();

    const { data: request } = await employeeA.client
      .from("purchase_requests")
      .select("status, rejection_reason")
      .eq("id", requestId)
      .single();
    expect(request?.status).toBe("approved");
    expect(request?.rejection_reason).toBeNull();

    const { data: notifs } = await employeeA.client
      .from("notifications")
      .select("payload")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_resolved");
    expect(notifs).toHaveLength(1);
    expect(notifs?.[0]?.payload).toMatchObject({ status: "approved" });

    const { data: step } = await serviceRole
      .from("purchase_request_steps")
      .select("status, decided_by")
      .eq("request_id", requestId)
      .single();
    expect(step?.status).toBe("approved");
  });

  it("rechazo exige comentario obligatorio; con comentario lo persiste", async () => {
    const requestId = await createRequest();

    const { error: missingReasonError } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "rejected",
      p_rejection_reason: null,
    });
    expect(missingReasonError).not.toBeNull();

    const { error: blankReasonError } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "rejected",
      p_rejection_reason: "   ",
    });
    expect(blankReasonError).not.toBeNull();

    const { error } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "rejected",
      p_rejection_reason: "Ya tenemos una herramienta equivalente en el stack.",
    });
    expect(error).toBeNull();

    const { data: request } = await employeeA.client
      .from("purchase_requests")
      .select("status, rejection_reason")
      .eq("id", requestId)
      .single();
    expect(request?.status).toBe("rejected");
    expect(request?.rejection_reason).toBe("Ya tenemos una herramienta equivalente en el stack.");

    const { data: notifs } = await employeeA.client
      .from("notifications")
      .select("payload")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_resolved");
    expect(notifs?.[0]?.payload).toMatchObject({ status: "rejected" });
  });

  it("finance/employee (no son el aprobador del paso activo) no pueden resolver", async () => {
    const requestId = await createRequest();

    const { error: financeError } = await finance.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(financeError).not.toBeNull();

    const { error: employeeError } = await employeeB.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(employeeError).not.toBeNull();

    const { data: request } = await employeeA.client
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(request?.status).toBe("pending");
  });

  it("resolve_purchase_request solo actúa sobre el paso activo — no dos veces sobre la misma solicitud", async () => {
    const requestId = await createRequest();
    await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });

    const { error } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "rejected",
      p_rejection_reason: "demasiado tarde",
    });
    expect(error).not.toBeNull();
  });

  it("el propio solicitante cancela su solicitud pending; nadie más puede, y no se puede cancelar dos veces", async () => {
    const requestId = await createRequest();

    const { error: otherEmployeeError } = await employeeB.client.rpc("cancel_purchase_request", {
      p_request_id: requestId,
    });
    expect(otherEmployeeError).not.toBeNull();

    const { error: financeError } = await finance.client.rpc("cancel_purchase_request", {
      p_request_id: requestId,
    });
    expect(financeError).not.toBeNull();

    const { error } = await employeeA.client.rpc("cancel_purchase_request", { p_request_id: requestId });
    expect(error).toBeNull();

    const { data: request } = await employeeA.client
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(request?.status).toBe("cancelled");

    const { error: secondCancelError } = await employeeA.client.rpc("cancel_purchase_request", {
      p_request_id: requestId,
    });
    expect(secondCancelError).not.toBeNull();
  });

  it("mark_purchase_request_purchased solo desde approved, y solo el solicitante o finance/org_admin", async () => {
    const requestId = await createRequest();
    await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });

    const { error: otherEmployeeError } = await employeeB.client.rpc("mark_purchase_request_purchased", {
      p_request_id: requestId,
    });
    expect(otherEmployeeError).not.toBeNull();

    const { error } = await employeeA.client.rpc("mark_purchase_request_purchased", {
      p_request_id: requestId,
    });
    expect(error).toBeNull();

    const { data: request } = await employeeA.client
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(request?.status).toBe("purchased");

    const { error: secondMarkError } = await employeeA.client.rpc("mark_purchase_request_purchased", {
      p_request_id: requestId,
    });
    expect(secondMarkError).not.toBeNull();
  });

  it("finance también puede marcar como comprada una solicitud aprobada de otro usuario", async () => {
    const requestId = await createRequest();
    await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });

    const { error } = await finance.client.rpc("mark_purchase_request_purchased", { p_request_id: requestId });
    expect(error).toBeNull();
  });

  it("RLS: requester, org_admin, finance (rol amplio) y el aprobador del paso ven la solicitud; un empleado ajeno no", async () => {
    const requestId = await createRequest();

    const { data: managerRows } = await manager.client.from("purchase_requests").select("id").eq("id", requestId);
    expect(managerRows).toHaveLength(1);

    const { data: adminRows } = await admin.client.from("purchase_requests").select("id").eq("id", requestId);
    expect(adminRows).toHaveLength(1);

    const { data: financeRows } = await finance.client.from("purchase_requests").select("id").eq("id", requestId);
    expect(financeRows).toHaveLength(1); // finance conserva visibilidad amplia de 3.1b, no solo la de sus pasos

    const { data: employeeBRows } = await employeeB.client
      .from("purchase_requests")
      .select("id")
      .eq("id", requestId);
    expect(employeeBRows).toHaveLength(0);

    // purchase_request_steps: visibilidad más estricta, acotada al aprobador
    // real/requester/org_admin — un empleado ajeno no ve el paso ni a través
    // de esta tabla.
    const { data: stepsForStranger } = await employeeB.client
      .from("purchase_request_steps")
      .select("id")
      .eq("request_id", requestId);
    expect(stepsForStranger).toHaveLength(0);
  });

  it("idempotencia: el índice único de notifications rechaza una segunda fila (request_id, step_order, user_id, type) repetida", async () => {
    const requestId = await createRequest();
    const managerId = await publicUserId(manager);

    const { data: existing } = await serviceRole
      .from("notifications")
      .select("id, org_id, step_order")
      .eq("request_id", requestId)
      .eq("user_id", managerId)
      .eq("type", "purchase_request_step_pending")
      .single();
    expect(existing).not.toBeNull();

    const { error: duplicateError } = await serviceRole.from("notifications").insert({
      org_id: existing!.org_id,
      user_id: managerId,
      type: "purchase_request_step_pending",
      request_id: requestId,
      step_order: existing!.step_order,
      payload: {},
    });
    expect(duplicateError).not.toBeNull();
  });
});
