// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Administración de approval_rules (bloque 3.2b) — crea orgs/usuarios reales.
// Solo debe correr contra la instancia LOCAL de Supabase, nunca remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`approval-rules.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`);
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

async function getOrgId(tenant: TestTenant): Promise<string> {
  const { data } = await tenant.client.from("users").select("org_id").eq("auth_id", tenant.userId).single();
  return data!.org_id as string;
}

describe("save_approval_rule_scope()", () => {
  let admin: TestTenant;
  let finance: TestTenant;
  let orgId: string;

  beforeAll(async () => {
    admin = await signUpOrg("rules-admin");
    finance = await inviteAndAccept(admin, "finance", "rules-fin");
    orgId = await getOrgId(admin);
  });

  it("guarda un tramo válido y reemplaza atómicamente el scope global", async () => {
    const { error } = await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [
        { max_amount: 500, steps: [{ approver_type: "auto" }] },
        { max_amount: 5000, steps: [{ approver_type: "manager_of_requester" }] },
        {
          max_amount: null,
          steps: [{ approver_type: "manager_of_requester" }, { approver_type: "role", approver_role: "finance" }],
        },
      ],
    });
    expect(error).toBeNull();

    const { data: rules } = await serviceRole
      .from("approval_rules")
      .select("min_amount, max_amount, step_order, approver_type, approver_role")
      .eq("org_id", orgId)
      .is("department_id", null)
      .order("min_amount")
      .order("step_order");
    expect(rules).toHaveLength(4);
    expect(Number(rules?.[0]?.min_amount)).toBe(0);
    expect(Number(rules?.[0]?.max_amount)).toBe(500);
    expect(rules?.[0]?.approver_type).toBe("auto");
    expect(rules?.[3]).toMatchObject({ step_order: 2, approver_type: "role", approver_role: "finance" });
  });

  it.each([
    [
      "max_amount no ascendente",
      [
        { max_amount: 500, steps: [{ approver_type: "auto" }] },
        { max_amount: 200, steps: [{ approver_type: "manager_of_requester" }] },
        { max_amount: null, steps: [{ approver_type: "role", approver_role: "finance" }] },
      ],
    ],
    [
      "max_amount null en un tramo que no es el último",
      [
        { max_amount: null, steps: [{ approver_type: "auto" }] },
        { max_amount: 5000, steps: [{ approver_type: "manager_of_requester" }] },
      ],
    ],
    [
      "'auto' con más de un paso en el tramo",
      [
        { max_amount: 500, steps: [{ approver_type: "auto" }, { approver_type: "role", approver_role: "finance" }] },
        { max_amount: null, steps: [{ approver_type: "manager_of_requester" }] },
      ],
    ],
    ["tramo sin ningún paso", [{ max_amount: 500, steps: [] }, { max_amount: null, steps: [{ approver_type: "auto" }] }]],
    ["approver_role inválido", [{ max_amount: null, steps: [{ approver_type: "role", approver_role: "ceo" }] }]],
  ])("rechaza: %s", async (_label, tiers) => {
    const { error } = await admin.client.rpc("save_approval_rule_scope", { p_department_id: null, p_tiers: tiers });
    expect(error).not.toBeNull();
  });

  it("rechaza specific_user con un usuario fuera de la organización", async () => {
    const { error } = await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [{ max_amount: null, steps: [{ approver_type: "specific_user", approver_user_id: crypto.randomUUID() }] }],
    });
    expect(error).not.toBeNull();
  });

  it("finance (no org_admin) no puede editar las reglas", async () => {
    const { error } = await finance.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [{ max_amount: null, steps: [{ approver_type: "auto" }] }],
    });
    expect(error).not.toBeNull();
  });
});

describe("restore_default_approval_rules()", () => {
  let admin: TestTenant;
  let orgId: string;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("rules-restore-admin");
    orgId = await getOrgId(admin);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `Restore Dept ${randomSuffix()}`,
      p_manager_user_id: null,
    });
    departmentId = deptId as string;
  });

  it("global: repone el seed literal (0/500/5000) en la moneda default de la org", async () => {
    await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [{ max_amount: null, steps: [{ approver_type: "auto" }] }],
    });

    const { error } = await admin.client.rpc("restore_default_approval_rules", { p_department_id: null });
    expect(error).toBeNull();

    const { data: rules } = await serviceRole
      .from("approval_rules")
      .select("min_amount, max_amount, step_order, approver_type, approver_role")
      .eq("org_id", orgId)
      .is("department_id", null)
      .order("min_amount")
      .order("step_order");
    expect(rules).toHaveLength(4);
    expect(Number(rules?.[0]?.min_amount)).toBe(0);
    expect(Number(rules?.[0]?.max_amount)).toBe(500);
    expect(Number(rules?.[1]?.max_amount)).toBe(5000);
    expect(rules?.[3]).toMatchObject({ step_order: 2, approver_type: "role", approver_role: "finance" });
  });

  it("departamento: borra sus overrides y vuelve a heredar la global (no inserta filas)", async () => {
    await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: departmentId,
      p_tiers: [{ max_amount: null, steps: [{ approver_type: "auto" }] }],
    });

    const { error } = await admin.client.rpc("restore_default_approval_rules", { p_department_id: departmentId });
    expect(error).toBeNull();

    const { data: rules } = await serviceRole
      .from("approval_rules")
      .select("id")
      .eq("org_id", orgId)
      .eq("department_id", departmentId);
    expect(rules).toHaveLength(0);
  });
});

describe("Inmutabilidad: editar reglas con una solicitud multi-paso en vuelo", () => {
  it("el paso ya materializado no cambia, y la solicitud avanza con normalidad tras la edición", async () => {
    const admin = await signUpOrg("rules-inflight-admin");
    const manager = await inviteAndAccept(admin, "manager", "rules-inflight-mgr");
    const finance = await inviteAndAccept(admin, "finance", "rules-inflight-fin");
    const employee = await inviteAndAccept(admin, "employee", "rules-inflight-emp");

    const managerId = await publicUserId(manager);
    const { data: deptId } = await admin.client.rpc("create_department", {
      p_name: `In-flight Dept ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });
    const employeeId = await publicUserId(employee);
    await admin.client.rpc("update_user_department", { p_user_id: employeeId, p_department_id: deptId });

    await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [
        { max_amount: 500, steps: [{ approver_type: "auto" }] },
        { max_amount: 5000, steps: [{ approver_type: "manager_of_requester" }] },
        {
          max_amount: null,
          steps: [{ approver_type: "manager_of_requester" }, { approver_type: "role", approver_role: "finance" }],
        },
      ],
    });

    const { data: requestId, error } = await employee.client.rpc("create_purchase_request", {
      p_catalog_id: null,
      p_vendor_name: "In-flight edit test",
      p_estimated_annual_cost: 12000,
      p_currency: "EUR",
      p_department_id: deptId,
      p_justification: "In-flight edit test with sufficient length.",
      p_alternatives_considered: null,
    });
    expect(error).toBeNull();

    const { error: mgrErr } = await manager.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(mgrErr).toBeNull();

    const { data: stepsBefore } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order");
    expect(stepsBefore?.[1]).toMatchObject({ status: "pending", approver_role: "finance" });

    const { error: editErr } = await admin.client.rpc("save_approval_rule_scope", {
      p_department_id: null,
      p_tiers: [
        { max_amount: 500, steps: [{ approver_type: "auto" }] },
        { max_amount: 5000, steps: [{ approver_type: "manager_of_requester" }] },
        { max_amount: null, steps: [{ approver_type: "role", approver_role: "finance" }] },
      ],
    });
    expect(editErr).toBeNull();

    const { data: stepsAfter } = await serviceRole
      .from("purchase_request_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order");
    expect(stepsAfter).toHaveLength(2);
    expect(stepsAfter?.[1]).toMatchObject({ status: "pending", approver_role: "finance" });

    const { error: finErr } = await finance.client.rpc("resolve_purchase_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_rejection_reason: null,
    });
    expect(finErr).toBeNull();

    const { data: finalRequest } = await serviceRole
      .from("purchase_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(finalRequest?.status).toBe("approved");
  });
});
