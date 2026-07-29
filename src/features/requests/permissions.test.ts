// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
