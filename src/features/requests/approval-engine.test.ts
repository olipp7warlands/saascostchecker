// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseApprovalToken } from "./approval-links";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Motor de aprobaciones (bloque 3.2a) — crea orgs/usuarios reales. Solo debe
// correr contra la instancia LOCAL de Supabase, nunca contra el remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`approval-engine.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`);
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
  const { data, error } = await tenant.client.from("users").select("id").eq("auth_id", tenant.userId).single();
  if (error || !data) throw error ?? new Error("public user row not found");
  return data.id as string;
}

function createRequestParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    p_catalog_id: null,
    p_vendor_name: "Test Tool",
    p_estimated_annual_cost: 1200,
    p_currency: "EUR",
    p_department_id: null,
    p_justification: "Justificación de prueba con longitud suficiente.",
    p_alternatives_considered: null,
    ...overrides,
  };
}

async function tokenParts(rawToken: string) {
  const parsed = parseApprovalToken(rawToken);
  if (!parsed) throw new Error(`token con formato inesperado: ${rawToken}`);
  return parsed;
}

describe("Materialización de pasos y seed por org (bloque 3.2a)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let manager: TestTenant;
  let finance: TestTenant;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("engine-admin");
    [employee, manager, finance] = await Promise.all([
      inviteAndAccept(admin, "employee", "engine-emp"),
      inviteAndAccept(admin, "manager", "engine-mgr"),
      inviteAndAccept(admin, "finance", "engine-fin"),
    ]);

    const managerId = await publicUserId(manager);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Engine Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    departmentId = deptId as string;

    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: departmentId });
  });

  it("la org nace con la matriz default de 4 reglas (auto/manager/manager+finance)", async () => {
    const { data: orgRow } = await admin.client.from("users").select("org_id").eq("auth_id", admin.userId).single();
    const { data: rules } = await serviceRole
      .from("approval_rules")
      .select("min_amount, max_amount, step_order, approver_type, approver_role")
      .eq("org_id", orgRow!.org_id)
      .order("step_order");

    expect(rules).toHaveLength(4);
    expect(rules?.[0]).toMatchObject({ min_amount: "0.00", max_amount: "500.00", approver_type: "auto" });
    expect(rules?.[3]).toMatchObject({ approver_type: "role", approver_role: "finance", step_order: 2 });
  });

  it("tier auto (<500): la solicitud queda approved sin materializar ningún paso", async () => {
    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 100, p_department_id: departmentId }),
    );
    expect(error).toBeNull();

    const { data: request } = await serviceRole.from("purchase_requests").select("status").eq("id", requestId).single();
    expect(request?.status).toBe("approved");

    const { data: steps } = await serviceRole.from("purchase_request_steps").select("id").eq("request_id", requestId);
    expect(steps).toHaveLength(0);
  });

  it("tier manager (500-5000): 1 paso pending resuelto al manager real del departamento", async () => {
    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: departmentId }),
    );
    expect(error).toBeNull();

    const { data: steps } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order");
    const managerId = await publicUserId(manager);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ status: "pending", resolved_approver_id: managerId, resolved_via: "rule" });
  });

  it("tier manager+finance (>5000): 2 pasos, avanza de manager a finance, y aprueba al final", async () => {
    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 12000, p_department_id: departmentId }),
    );
    expect(error).toBeNull();

    let { data: steps } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order");
    expect(steps).toHaveLength(2);
    expect(steps?.[0].status).toBe("pending");
    expect(steps?.[1]).toMatchObject({ status: "queued", approver_type: "role", approver_role: "finance" });

    const { error: managerError } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(managerError).toBeNull();

    ({ data: steps } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order"));
    expect(steps?.[0].status).toBe("approved");
    expect(steps?.[1].status).toBe("pending");

    const { data: midRequest } = await serviceRole
      .from("purchase_requests")
      .select("status, current_step")
      .eq("id", requestId)
      .single();
    expect(midRequest).toMatchObject({ status: "pending", current_step: 2 });

    const { error: financeError } = await finance.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(financeError).toBeNull();

    const { data: finalRequest } = await serviceRole
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(finalRequest?.status).toBe("approved");
  });

  it("precedencia: una regla propia del departamento sustituye ENTERA a la global para ese tramo", async () => {
    const { data: orgRow } = await admin.client.from("users").select("org_id").eq("auth_id", admin.userId).single();
    const financeId = await publicUserId(finance);

    // Sin RPC de edición todavía (3.2b) — se inserta directo, simulando lo
    // que esa RPC futura hará. Tramo 500-5000 del departamento resuelve
    // directo a finance (specific_user), no al manager (regla global).
    await serviceRole.from("approval_rules").insert({
      org_id: orgRow!.org_id,
      department_id: departmentId,
      min_amount: 500,
      max_amount: 5000,
      step_order: 1,
      approver_type: "specific_user",
      approver_user_id: financeId,
    });

    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: departmentId }),
    );
    expect(error).toBeNull();

    const { data: steps } = await serviceRole.from("purchase_request_steps").select("*").eq("request_id", requestId);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ approver_type: "specific_user", resolved_approver_id: financeId });

    await serviceRole
      .from("approval_rules")
      .delete()
      .eq("org_id", orgRow!.org_id)
      .eq("department_id", departmentId);
  });

  it("conversión de moneda: un importe en USD se evalúa en EUR (moneda default) antes del umbral", async () => {
    // exchange_rates seed (0011_dashboard.sql): USD->EUR = 0.93. 6000 USD ~
    // 5580 EUR -> cae en el tramo >5000 (manager+finance), no en 500-5000.
    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 6000, p_currency: "USD", p_department_id: departmentId }),
    );
    expect(error).toBeNull();

    const { data: steps } = await serviceRole.from("purchase_request_steps").select("step_order").eq("request_id", requestId);
    expect(steps).toHaveLength(2); // tramo >5000 tiene 2 pasos (manager + finance); 500-5000 solo tendría 1
  });
});

describe("Fallback sin manager y tope al auto-skip (bloque 3.2a)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let finance: TestTenant;
  let noManagerDeptId: string;

  beforeAll(async () => {
    admin = await signUpOrg("cap-admin");
    [employee, finance] = await Promise.all([
      inviteAndAccept(admin, "employee", "cap-emp"),
      inviteAndAccept(admin, "finance", "cap-fin"),
    ]);

    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `No Manager Dept ${randomSuffix()}`,
      p_manager_user_id: null,
    });
    noManagerDeptId = deptId as string;

    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: noManagerDeptId });
  });

  it("departamento sin manager: el paso resuelve a rol org_admin con resolved_via='fallback_no_manager'", async () => {
    const { data: requestId, error } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: noManagerDeptId }),
    );
    expect(error).toBeNull();

    const { data: steps } = await serviceRole.from("purchase_request_steps").select("*").eq("request_id", requestId);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({
      approver_role: "org_admin",
      resolved_approver_id: null,
      resolved_via: "fallback_no_manager",
      status: "pending",
    });
  });

  it("tope al auto-skip: org_admin solicitando en depto sin manager NO se auto-aprueba, se reasigna a finance", async () => {
    const { data: requestId, error } = await admin.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: noManagerDeptId }),
    );
    expect(error).toBeNull();

    const { data: request } = await serviceRole.from("purchase_requests").select("status").eq("id", requestId).single();
    expect(request?.status).toBe("pending");

    const { data: steps } = await serviceRole.from("purchase_request_steps").select("*").eq("request_id", requestId);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({
      approver_role: "finance",
      resolved_approver_id: null,
      resolved_via: "reassigned_self_approval",
      status: "pending",
    });

    const { error: financeError } = await finance.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(financeError).toBeNull();
  });
});

describe("Inmutabilidad del snapshot de pasos (bloque 3.2a)", () => {
  it("editar approval_rules después de crear una solicitud no altera sus pasos ya materializados", async () => {
    const admin = await signUpOrg("immut-admin");
    const employee = await inviteAndAccept(admin, "employee", "immut-emp");
    const manager = await inviteAndAccept(admin, "manager", "immut-mgr");

    const managerId = await publicUserId(manager);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Immut Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: deptId });

    const { data: orgRow } = await admin.client.from("users").select("org_id").eq("auth_id", admin.userId).single();

    const { data: requestId } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: deptId }),
    );

    const { data: stepBefore } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .single();
    expect(stepBefore).toMatchObject({ approver_type: "manager_of_requester", resolved_approver_id: managerId });

    // Sin RPC de edición (3.2b) — se edita la regla global 500-5000 directo.
    await serviceRole
      .from("approval_rules")
      .update({ approver_type: "role", approver_role: "finance" })
      .eq("org_id", orgRow!.org_id)
      .is("department_id", null)
      .eq("min_amount", 500)
      .eq("max_amount", 5000);

    const { data: stepAfter } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("id", stepBefore!.id)
      .single();
    expect(stepAfter).toMatchObject({ approver_type: "manager_of_requester", resolved_approver_id: managerId });

    const { data: newRequestId } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: deptId }),
    );
    const { data: newStep } = await serviceRole
      .from("purchase_request_steps")
      .select("approver_type, approver_role")
      .eq("request_id", newRequestId)
      .single();
    expect(newStep).toMatchObject({ approver_type: "role", approver_role: "finance" });
  });
});

describe("Links de aprobación de un solo uso (bloque 3.2a)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let manager: TestTenant;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("link-admin");
    [employee, manager] = await Promise.all([
      inviteAndAccept(admin, "employee", "link-emp"),
      inviteAndAccept(admin, "manager", "link-mgr"),
    ]);

    const managerId = await publicUserId(manager);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Link Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    departmentId = deptId as string;
    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: departmentId });
  });

  async function createRequestWithToken() {
    const { data: requestId } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: departmentId }),
    );
    const { data: notif } = await serviceRole
      .from("notifications")
      .select("payload")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_step_pending")
      .single();
    const raw = (notif!.payload as { approval_token: string }).approval_token;
    return { requestId: requestId as string, raw, ...(await tokenParts(raw)) };
  }

  it("un solo uso: aprobar por link funciona una vez; el mismo link reintentado falla genérico y sin efecto duplicado", async () => {
    const { requestId, tokenId, secret } = await createRequestWithToken();

    const { error: firstUse } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(firstUse).toBeNull();

    const { data: request } = await serviceRole.from("purchase_requests").select("status").eq("id", requestId).single();
    expect(request?.status).toBe("approved");

    const { error: secondUse } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(secondUse?.message).toContain("invalid_or_expired_token");

    const { data: actions } = await serviceRole.from("approval_actions").select("id").eq("request_id", requestId);
    expect(actions).toHaveLength(1);
  });

  it("secreto incorrecto y token inexistente devuelven el mismo mensaje genérico", async () => {
    const { tokenId } = await createRequestWithToken();

    const { error: wrongSecret } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: "not-the-real-secret",
      p_decision: "approved",
      p_comment: null,
    });
    expect(wrongSecret?.message).toContain("invalid_or_expired_token");

    const { error: bogusId } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: "00000000-0000-0000-0000-000000000000",
      p_secret: "whatever",
      p_decision: "approved",
      p_comment: null,
    });
    expect(bogusId?.message).toContain("invalid_or_expired_token");
  });

  it("token expirado (backdateado) devuelve el mensaje genérico", async () => {
    const { tokenId, secret } = await createRequestWithToken();
    await serviceRole
      .from("approval_link_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", tokenId);

    const { error } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(error?.message).toContain("invalid_or_expired_token");
  });

  it("revocación cruzada: resolver por la UI autenticada invalida el link vivo de ese paso", async () => {
    const { requestId, tokenId, secret } = await createRequestWithToken();

    const { error: uiError } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(uiError).toBeNull();

    const { error: linkError } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(linkError?.message).toContain("invalid_or_expired_token");

    const { data: actions } = await serviceRole.from("approval_actions").select("id").eq("request_id", requestId);
    expect(actions).toHaveLength(1);
  });

  it("rechazar por link exige comentario, igual que la UI autenticada", async () => {
    const { tokenId, secret } = await createRequestWithToken();

    const { error: missingComment } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "rejected",
      p_comment: null,
    });
    expect(missingComment).not.toBeNull();
    expect(missingComment?.message).not.toContain("invalid_or_expired_token");

    const { error } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: tokenId,
      p_secret: secret,
      p_decision: "rejected",
      p_comment: "No encaja con el presupuesto.",
    });
    expect(error).toBeNull();
  });
});

describe("Recordatorio 72h / escalado 7d — idempotencia (bloque 3.2a)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let manager: TestTenant;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("cron-admin");
    [employee, manager] = await Promise.all([
      inviteAndAccept(admin, "employee", "cron-emp"),
      inviteAndAccept(admin, "manager", "cron-mgr"),
    ]);

    const managerId = await publicUserId(manager);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Cron Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    departmentId = deptId as string;
    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: departmentId });
  });

  async function createRequestWithStep() {
    const { data: requestId } = await employee.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 1200, p_department_id: departmentId }),
    );
    const { data: step } = await serviceRole
      .from("purchase_request_steps")
      .select("id")
      .eq("request_id", requestId)
      .single();
    return { requestId: requestId as string, stepId: step!.id as string };
  }

  it("recordatorio: dos pasadas del evaluador no duplican la notificación", async () => {
    const { requestId, stepId } = await createRequestWithStep();
    await serviceRole
      .from("purchase_request_steps")
      .update({ step_started_at: new Date(Date.now() - 80 * 3600 * 1000).toISOString() })
      .eq("id", stepId);

    await serviceRole.rpc("evaluate_approval_reminders_and_escalations");
    await serviceRole.rpc("evaluate_approval_reminders_and_escalations");

    const { data: reminders } = await serviceRole
      .from("notifications")
      .select("id")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_reminder");
    expect(reminders).toHaveLength(1);

    const { data: step } = await serviceRole.from("purchase_request_steps").select("reminded_at").eq("id", stepId).single();
    expect(step?.reminded_at).not.toBeNull();
  });

  it("escalado: dos pasadas no duplican el escalado ni la notificación; revoca el link viejo del manager", async () => {
    const { requestId, stepId } = await createRequestWithStep();
    const { data: notifBefore } = await serviceRole
      .from("notifications")
      .select("payload")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_step_pending")
      .single();
    const oldToken = await tokenParts((notifBefore!.payload as { approval_token: string }).approval_token);

    await serviceRole
      .from("purchase_request_steps")
      .update({ step_started_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() })
      .eq("id", stepId);

    await serviceRole.rpc("evaluate_approval_reminders_and_escalations");
    await serviceRole.rpc("evaluate_approval_reminders_and_escalations");

    const { data: step } = await serviceRole.from("purchase_request_steps").select("*").eq("id", stepId).single();
    expect(step).toMatchObject({
      status: "escalated_to_org_admin",
      approver_role: "org_admin",
      resolved_approver_id: null,
      resolved_via: "escalated_timeout",
    });

    const { data: escalatedNotifs } = await serviceRole
      .from("notifications")
      .select("id")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_escalated");
    expect(escalatedNotifs).toHaveLength(1);

    const { data: escalatedActions } = await serviceRole
      .from("approval_actions")
      .select("id")
      .eq("request_id", requestId)
      .eq("action", "escalated");
    expect(escalatedActions).toHaveLength(1);

    const { error: oldLinkError } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: oldToken.tokenId,
      p_secret: oldToken.secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(oldLinkError?.message).toContain("invalid_or_expired_token");
  });
});
