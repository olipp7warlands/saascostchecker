// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Este test crea usuarios/orgs reales vía signUp()/RPCs. Solo debe correr
// contra la instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `permissions.test.ts (budgets) apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
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

async function inviteAndAccept(
  orgAdmin: TestTenant,
  role: string,
  label: string,
): Promise<TestTenant> {
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
    options: {
      data: {
        full_name: `${label} User`,
        invitation_token_hash: tokenHash,
      },
    },
  });

  if (error || !data.user) {
    throw error ?? new Error("signUp did not return a user");
  }

  return { client, userId: data.user.id, email };
}

async function createDepartmentForOrg(tenant: TestTenant, name: string) {
  const { data, error } = await tenant.client.rpc("create_department", {
    p_name: name,
    p_manager_user_id: null,
  });
  return { departmentId: data as string | null, error };
}

describe("Permisos de budgets (bloque nuevo: tags + presupuestos)", () => {
  let admin: TestTenant;
  let finance: TestTenant;
  let itAdmin: TestTenant;
  let manager: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;
  let departmentId: string;

  beforeAll(async () => {
    admin = await signUpOrg("bud-admin");

    [finance, itAdmin, manager, employee] = await Promise.all([
      inviteAndAccept(admin, "finance", "bud-finance"),
      inviteAndAccept(admin, "it_admin", "bud-itadmin"),
      inviteAndAccept(admin, "manager", "bud-manager"),
      inviteAndAccept(admin, "employee", "bud-employee"),
    ]);

    otherOrgAdmin = await signUpOrg("bud-other");

    const { departmentId: id, error } = await createDepartmentForOrg(admin, `Eng ${randomSuffix()}`);
    if (error || !id) throw error ?? new Error("could not create department");
    departmentId = id;
  });

  it.each([
    ["finance", () => finance, 2026],
    ["org_admin", () => admin, 2034],
  ])("%s puede crear una bolsa de presupuesto", async (_role, getTenant, fiscalYear) => {
    // Año fiscal distinto por caso: dos filas para el mismo (org, depto,
    // año) chocarían con budgets_scope_unique_idx, que no es lo que este
    // test quiere ejercitar.
    const { data, error } = await getTenant().client.rpc("create_budget", {
      p_company_id: null,
      p_department_id: departmentId,
      p_fiscal_year: fiscalYear,
      p_amount: 1000,
      p_currency: "EUR",
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it.each([
    ["it_admin", () => itAdmin],
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede crear una bolsa de presupuesto", async (_role, getTenant) => {
    const { error } = await getTenant().client.rpc("create_budget", {
      p_company_id: null,
      p_department_id: departmentId,
      p_fiscal_year: 2026,
      p_amount: 500,
      p_currency: "EUR",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("una bolsa sin empresa ni departamento es rechazada", async () => {
    const { error } = await admin.client.rpc("create_budget", {
      p_company_id: null,
      p_department_id: null,
      p_fiscal_year: 2027,
      p_amount: 500,
      p_currency: "EUR",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/company.*department|scope/i);
  });

  it("finance puede editar y borrar una bolsa; it_admin no puede ninguna de las dos cosas", async () => {
    const { data: budgetId, error: createError } = await admin.client.rpc("create_budget", {
      p_company_id: null,
      p_department_id: departmentId,
      p_fiscal_year: 2030,
      p_amount: 1000,
      p_currency: "EUR",
    });
    expect(createError).toBeNull();

    const { error: itAdminUpdateError } = await itAdmin.client.rpc("update_budget", {
      p_budget_id: budgetId,
      p_amount: 2000,
      p_currency: "EUR",
    });
    expect(itAdminUpdateError).not.toBeNull();
    expect(itAdminUpdateError?.message).toMatch(/insufficient privileges/i);

    const { error: itAdminDeleteError } = await itAdmin.client.rpc("delete_budget", {
      p_budget_id: budgetId,
    });
    expect(itAdminDeleteError).not.toBeNull();
    expect(itAdminDeleteError?.message).toMatch(/insufficient privileges/i);

    const { error: updateError } = await finance.client.rpc("update_budget", {
      p_budget_id: budgetId,
      p_amount: 2500,
      p_currency: "EUR",
    });
    expect(updateError).toBeNull();

    const { error: deleteError } = await finance.client.rpc("delete_budget", {
      p_budget_id: budgetId,
    });
    expect(deleteError).toBeNull();
  });

  it("finance/it_admin/org_admin leen las bolsas de su org; manager/employee no ven ninguna fila", async () => {
    const { data: budgetId, error: createError } = await admin.client.rpc("create_budget", {
      p_company_id: null,
      p_department_id: departmentId,
      p_fiscal_year: 2031,
      p_amount: 1000,
      p_currency: "EUR",
    });
    expect(createError).toBeNull();

    for (const tenant of [finance, itAdmin, admin]) {
      const { data, error } = await tenant.client.from("budgets").select("id").eq("id", budgetId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }

    for (const tenant of [manager, employee]) {
      const { data, error } = await tenant.client.from("budgets").select("id").eq("id", budgetId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    }
  });

  it("un org_admin no puede editar/borrar una bolsa de otra org", async () => {
    const { departmentId: otherDeptId, error: deptError } = await createDepartmentForOrg(
      otherOrgAdmin,
      `Other ${randomSuffix()}`,
    );
    expect(deptError).toBeNull();

    const { data: otherBudgetId, error: createError } = await otherOrgAdmin.client.rpc(
      "create_budget",
      { p_company_id: null, p_department_id: otherDeptId, p_fiscal_year: 2032, p_amount: 1000, p_currency: "EUR" },
    );
    expect(createError).toBeNull();

    const { error: updateError } = await admin.client.rpc("update_budget", {
      p_budget_id: otherBudgetId,
      p_amount: 1,
      p_currency: "EUR",
    });
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toMatch(/budget not found/i);

    const { error: deleteError } = await otherOrgAdmin.client.rpc("delete_budget", {
      p_budget_id: otherBudgetId,
    });
    expect(deleteError).toBeNull();
  });
});
