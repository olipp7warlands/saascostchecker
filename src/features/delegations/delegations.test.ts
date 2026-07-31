// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseApprovalToken } from "@/features/requests/approval-links";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Delegaciones de aprobación (bloque 3.2b) — crea orgs/usuarios reales. Solo
// debe correr contra la instancia LOCAL de Supabase, nunca contra el remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`delegations.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`);
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

function isoDate(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
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

describe("RPCs de gestión de delegaciones", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let delegate: TestTenant;
  let finance: TestTenant;
  let employee: TestTenant;
  let managerId: string;
  let delegateId: string;
  let financeId: string;

  beforeAll(async () => {
    admin = await signUpOrg("deleg-mgmt-admin");
    [manager, delegate, finance, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "deleg-mgmt-mgr"),
      inviteAndAccept(admin, "manager", "deleg-mgmt-del"),
      inviteAndAccept(admin, "finance", "deleg-mgmt-fin"),
      inviteAndAccept(admin, "employee", "deleg-mgmt-emp"),
    ]);
    [managerId, delegateId, financeId] = await Promise.all([
      publicUserId(manager),
      publicUserId(delegate),
      publicUserId(finance),
    ]);
  });

  it("autoservicio: el propio delegante crea su delegación", async () => {
    const { data, error } = await manager.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: delegateId,
      p_starts_on: isoDate(-1),
      p_ends_on: isoDate(5),
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("rechaza delegarse a uno mismo", async () => {
    const { error } = await manager.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: managerId,
      p_starts_on: isoDate(10),
      p_ends_on: isoDate(15),
    });
    expect(error).not.toBeNull();
  });

  it("rechaza crear una delegación con fechas solapadas para el mismo delegante", async () => {
    const { error } = await manager.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: financeId,
      p_starts_on: isoDate(1),
      p_ends_on: isoDate(2),
    });
    expect(error).not.toBeNull();
  });

  it("un empleado ajeno no puede crear una delegación en nombre de otro", async () => {
    const { error } = await employee.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: financeId,
      p_starts_on: isoDate(30),
      p_ends_on: isoDate(35),
    });
    expect(error).not.toBeNull();
  });

  it("org_admin sí puede crear una delegación en nombre de otro", async () => {
    const { error } = await admin.client.rpc("create_approval_delegation", {
      p_delegator_user_id: financeId,
      p_delegate_user_id: managerId,
      p_starts_on: isoDate(30),
      p_ends_on: isoDate(35),
    });
    expect(error).toBeNull();
  });

  it("RLS: el delegante, el delegado y org_admin ven la delegación; un ajeno no", async () => {
    const { data: delegatorRows } = await manager.client
      .from("approval_delegations")
      .select("id")
      .eq("delegator_user_id", managerId);
    expect(delegatorRows!.length).toBeGreaterThan(0);

    const { data: delegateRows } = await delegate.client
      .from("approval_delegations")
      .select("id")
      .eq("delegator_user_id", managerId);
    expect(delegateRows!.length).toBeGreaterThan(0);

    const { data: adminRows } = await admin.client
      .from("approval_delegations")
      .select("id")
      .eq("delegator_user_id", managerId);
    expect(adminRows!.length).toBeGreaterThan(0);

    const { data: strangerRows } = await employee.client
      .from("approval_delegations")
      .select("id")
      .eq("delegator_user_id", managerId);
    expect(strangerRows).toHaveLength(0);
  });

  it("revocar: el delegante, org_admin, o quien la creó pueden; un ajeno no; no se puede revocar dos veces", async () => {
    const { data: delegationId } = await manager.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: delegateId,
      p_starts_on: isoDate(40),
      p_ends_on: isoDate(45),
    });

    const { error: strangerErr } = await employee.client.rpc("revoke_approval_delegation", {
      p_delegation_id: delegationId,
    });
    expect(strangerErr).not.toBeNull();

    const { error } = await manager.client.rpc("revoke_approval_delegation", { p_delegation_id: delegationId });
    expect(error).toBeNull();

    const { error: secondRevokeErr } = await manager.client.rpc("revoke_approval_delegation", {
      p_delegation_id: delegationId,
    });
    expect(secondRevokeErr).not.toBeNull();
  });
});

describe("Delegación aplicada al motor de aprobaciones", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let delegate: TestTenant;
  let finance: TestTenant;
  let employee: TestTenant;
  let managerId: string;
  let delegateId: string;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("deleg-engine-admin");
    [manager, delegate, finance, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "deleg-engine-mgr"),
      inviteAndAccept(admin, "manager", "deleg-engine-del"),
      inviteAndAccept(admin, "finance", "deleg-engine-fin"),
      inviteAndAccept(admin, "employee", "deleg-engine-emp"),
    ]);
    [managerId, delegateId] = await Promise.all([publicUserId(manager), publicUserId(delegate)]);

    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Delegation Engine Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    departmentId = deptId as string;

    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: departmentId });

    await manager.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: delegateId,
      p_starts_on: isoDate(-1),
      p_ends_on: isoDate(5),
    });
  });

  async function createRequest(overrides: Partial<Record<string, unknown>> = {}, requester = employee) {
    const { data: requestId, error } = await requester.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_department_id: departmentId, ...overrides }),
    );
    expect(error).toBeNull();
    return requestId as string;
  }

  it("el delegado aprueba vía UI autenticada; approval_actions registra actor real + delegante", async () => {
    const requestId = await createRequest();

    const { data: notifs } = await serviceRole
      .from("notifications")
      .select("user_id")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_step_pending");
    expect(notifs).toHaveLength(1);
    expect(notifs?.[0]?.user_id).toBe(delegateId);

    const { error } = await delegate.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(error).toBeNull();

    const { data: action } = await serviceRole
      .from("approval_actions")
      .select("actor_id, delegated_from_id")
      .eq("request_id", requestId)
      .eq("action", "approved")
      .single();
    expect(action?.actor_id).toBe(delegateId);
    expect(action?.delegated_from_id).toBe(managerId);
  });

  it("aditivo: el aprobador original también puede resolver durante la ventana de delegación", async () => {
    const requestId = await createRequest();

    const { error } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(error).toBeNull();

    const { data: action } = await serviceRole
      .from("approval_actions")
      .select("actor_id, delegated_from_id")
      .eq("request_id", requestId)
      .eq("action", "approved")
      .single();
    expect(action?.actor_id).toBe(managerId);
    expect(action?.delegated_from_id).toBeNull();
  });

  it("edge case: el delegado es el solicitante -> la notificación cae al original, y el delegado no puede auto-aprobarse", async () => {
    const requestId = await createRequest({}, delegate);

    const { data: notifs } = await serviceRole
      .from("notifications")
      .select("user_id")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_step_pending");
    expect(notifs).toHaveLength(1);
    expect(notifs?.[0]?.user_id).toBe(managerId);

    const { error: selfApproveErr } = await delegate.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(selfApproveErr).not.toBeNull();

    const { error } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(error).toBeNull();
  });

  it("atribución vía link firmado: actor = delegado, delegated_from = delegante (no el original por defecto)", async () => {
    const requestId = await createRequest();

    const { data: notif } = await serviceRole
      .from("notifications")
      .select("payload")
      .eq("request_id", requestId)
      .eq("type", "purchase_request_step_pending")
      .single();
    const rawToken = (notif!.payload as { approval_token: string }).approval_token;
    const parsed = parseApprovalToken(rawToken)!;

    const { data: tokenRow } = await serviceRole
      .from("approval_link_tokens")
      .select("token_actor_id, token_delegated_from_id")
      .eq("id", parsed.tokenId)
      .single();
    expect(tokenRow?.token_actor_id).toBe(delegateId);
    expect(tokenRow?.token_delegated_from_id).toBe(managerId);

    const { error } = await serviceRole.rpc("resolve_purchase_request_via_link", {
      p_token_id: parsed.tokenId,
      p_secret: parsed.secret,
      p_decision: "approved",
      p_comment: null,
    });
    expect(error).toBeNull();

    const { data: action } = await serviceRole
      .from("approval_actions")
      .select("actor_id, delegated_from_id")
      .eq("request_id", requestId)
      .eq("action", "approved")
      .single();
    expect(action?.actor_id).toBe(delegateId);
    expect(action?.delegated_from_id).toBe(managerId);
  });

  it("RLS: el delegado ve la solicitud/paso del delegante (no solo puede resolver vía RPC)", async () => {
    const requestId = await createRequest();

    const { data: reqRows } = await delegate.client.from("purchase_requests").select("id").eq("id", requestId);
    expect(reqRows).toHaveLength(1);

    const { data: stepRows } = await delegate.client
      .from("purchase_request_steps")
      .select("id")
      .eq("request_id", requestId);
    expect(stepRows).toHaveLength(1);
  });

  it("sin cadenas: un delegado no hereda la capacidad de re-delegar lo delegado", async () => {
    // El delegado intenta delegar EN OTRO la autoridad que él mismo recibió
    // (delegator_user_id = manager, no el propio delegado) -- rechazado,
    // solo el propio manager o org_admin pueden.
    const financeId = await publicUserId(finance);
    const { error } = await delegate.client.rpc("create_approval_delegation", {
      p_delegator_user_id: managerId,
      p_delegate_user_id: financeId,
      p_starts_on: isoDate(50),
      p_ends_on: isoDate(55),
    });
    expect(error).not.toBeNull();
  });
});
