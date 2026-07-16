// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Este test crea usuarios/orgs reales vía signUp()/RPCs. Solo debe correr
// contra la instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `permissions.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
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

// Invita (vía la RPC directamente, sin pasar por Resend) y acepta la
// invitación con un segundo cliente anónimo — da un usuario real con el rol
// pedido en la MISMA org que `orgAdmin`. No hace falta hashear el token de
// verdad: el trigger compara `token_hash` tal cual contra la metadata.
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

async function internalUserId(caller: TestTenant, email: string): Promise<string> {
  const { data, error } = await caller.client
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (error || !data) {
    throw error ?? new Error(`no internal user row for ${email}`);
  }

  return data.id;
}

describe("Matriz de permisos de SPECS §5 (bloque 0.3)", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let finance: TestTenant;
  let itAdmin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;

  let managerId: string;
  let employeeId: string;
  let otherOrgAdminId: string;

  beforeAll(async () => {
    admin = await signUpOrg("perm-admin");

    [manager, finance, itAdmin, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "perm-manager"),
      inviteAndAccept(admin, "finance", "perm-finance"),
      inviteAndAccept(admin, "it_admin", "perm-itadmin"),
      inviteAndAccept(admin, "employee", "perm-employee"),
    ]);

    otherOrgAdmin = await signUpOrg("perm-other");

    [managerId, employeeId, otherOrgAdminId] = await Promise.all([
      internalUserId(admin, manager.email),
      internalUserId(admin, employee.email),
      internalUserId(otherOrgAdmin, otherOrgAdmin.email),
    ]);
  });

  it("org_admin puede crear un departamento", async () => {
    const { data, error } = await admin.client.rpc("create_department", {
      p_name: `Ops ${randomSuffix()}`,
      p_manager_user_id: managerId,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it.each([
    ["manager", () => manager],
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["employee", () => employee],
  ])("%s NO puede crear un departamento", async (_role, getTenant) => {
    const { error } = await getTenant().client.rpc("create_department", {
      p_name: `Blocked ${randomSuffix()}`,
      p_manager_user_id: null,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("org_admin puede actualizar y borrar un departamento propio; manager no puede ninguna de las dos cosas", async () => {
    const { data: departmentId, error: createError } = await admin.client.rpc(
      "create_department",
      { p_name: `Editable ${randomSuffix()}`, p_manager_user_id: null },
    );
    expect(createError).toBeNull();

    const { error: managerUpdateError } = await manager.client.rpc("update_department", {
      p_department_id: departmentId,
      p_name: "Hijacked",
      p_manager_user_id: null,
    });
    expect(managerUpdateError).not.toBeNull();
    expect(managerUpdateError?.message).toMatch(/insufficient privileges/i);

    const { error: managerDeleteError } = await manager.client.rpc("delete_department", {
      p_department_id: departmentId,
    });
    expect(managerDeleteError).not.toBeNull();
    expect(managerDeleteError?.message).toMatch(/insufficient privileges/i);

    const { error: updateError } = await admin.client.rpc("update_department", {
      p_department_id: departmentId,
      p_name: "Renamed",
      p_manager_user_id: managerId,
    });
    expect(updateError).toBeNull();

    const { error: deleteError } = await admin.client.rpc("delete_department", {
      p_department_id: departmentId,
    });
    expect(deleteError).toBeNull();
  });

  it("org_admin puede cambiar el rol de otro usuario; manager NO puede cambiar roles (criterio de aceptación)", async () => {
    const { error: managerError } = await manager.client.rpc("update_user_role", {
      p_user_id: employeeId,
      p_new_role: "finance",
    });
    expect(managerError).not.toBeNull();
    expect(managerError?.message).toMatch(/insufficient privileges/i);

    const { error: adminError } = await admin.client.rpc("update_user_role", {
      p_user_id: employeeId,
      p_new_role: "finance",
    });
    expect(adminError).toBeNull();

    const { data: reloaded } = await admin.client
      .from("users")
      .select("role")
      .eq("id", employeeId)
      .single();
    expect(reloaded?.role).toBe("finance");

    // deja el usuario como estaba para no interferir con otros tests
    await admin.client.rpc("update_user_role", {
      p_user_id: employeeId,
      p_new_role: "employee",
    });
  });

  it.each([
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["employee", () => employee],
  ])("%s tampoco puede cambiar el rol de otro usuario", async (_role, getTenant) => {
    const { error } = await getTenant().client.rpc("update_user_role", {
      p_user_id: employeeId,
      p_new_role: "org_admin",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("org_admin puede asignar el departamento de un usuario; manager no puede", async () => {
    const { data: departmentId, error: createError } = await admin.client.rpc(
      "create_department",
      { p_name: `Assign ${randomSuffix()}`, p_manager_user_id: null },
    );
    expect(createError).toBeNull();

    const { error: managerError } = await manager.client.rpc("update_user_department", {
      p_user_id: employeeId,
      p_department_id: departmentId,
    });
    expect(managerError).not.toBeNull();
    expect(managerError?.message).toMatch(/insufficient privileges/i);

    const { error: adminError } = await admin.client.rpc("update_user_department", {
      p_user_id: employeeId,
      p_department_id: departmentId,
    });
    expect(adminError).toBeNull();

    const { data: reloaded } = await admin.client
      .from("users")
      .select("department_id")
      .eq("id", employeeId)
      .single();
    expect(reloaded?.department_id).toBe(departmentId);
  });

  it("ni siquiera org_admin puede cambiar role/department_id con un update directo — debe pasar por las RPCs", async () => {
    const { error: roleError } = await admin.client
      .from("users")
      .update({ role: "manager" })
      .eq("id", employeeId);
    expect(roleError).not.toBeNull();
    expect(roleError?.message).toMatch(/must be changed via update_user_role/i);

    const { error: departmentError } = await admin.client
      .from("users")
      .update({ department_id: null })
      .eq("id", employeeId);
    expect(departmentError).not.toBeNull();
    expect(departmentError?.message).toMatch(/must be changed via update_user_department/i);
  });

  it("un org_admin no puede modificar un departamento de otra org", async () => {
    const { data: otherDepartmentId, error: createError } = await otherOrgAdmin.client.rpc(
      "create_department",
      { p_name: `OrgB ${randomSuffix()}`, p_manager_user_id: null },
    );
    expect(createError).toBeNull();

    const { error: updateError } = await admin.client.rpc("update_department", {
      p_department_id: otherDepartmentId,
      p_name: "Hijacked cross-org",
      p_manager_user_id: null,
    });
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toMatch(/department not found/i);

    const { error: deleteError } = await admin.client.rpc("delete_department", {
      p_department_id: otherDepartmentId,
    });
    expect(deleteError).not.toBeNull();
    expect(deleteError?.message).toMatch(/department not found/i);
  });

  it("un org_admin no puede cambiar rol/departamento de un usuario de otra org", async () => {
    const { error: roleError } = await admin.client.rpc("update_user_role", {
      p_user_id: otherOrgAdminId,
      p_new_role: "employee",
    });
    expect(roleError).not.toBeNull();
    expect(roleError?.message).toMatch(/user not found/i);

    const { error: departmentError } = await admin.client.rpc("update_user_department", {
      p_user_id: otherOrgAdminId,
      p_department_id: null,
    });
    expect(departmentError).not.toBeNull();
    expect(departmentError?.message).toMatch(/user not found/i);
  });

  it.each([
    ["org_admin", () => admin],
    ["manager", () => manager],
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["employee", () => employee],
  ])("%s puede leer los departamentos de su propia org", async (_role, getTenant) => {
    const { data, error } = await getTenant().client.from("departments").select("id");

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  // Soporte multi-empresa (2026-07-16) — mismo esqueleto de permisos que
  // departments de arriba, ver docs/DECISIONS.md.
  it("org_admin puede crear una empresa", async () => {
    const { data, error } = await admin.client.rpc("create_company", {
      p_name: `Acme ${randomSuffix()}`,
      p_tax_id: "B12345678",
      p_is_default: false,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it.each([
    ["manager", () => manager],
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["employee", () => employee],
  ])("%s NO puede crear una empresa", async (_role, getTenant) => {
    const { error } = await getTenant().client.rpc("create_company", {
      p_name: `Blocked ${randomSuffix()}`,
      p_tax_id: null,
      p_is_default: false,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("org_admin puede actualizar y borrar una empresa propia; manager no puede ninguna de las dos cosas", async () => {
    const { data: companyId, error: createError } = await admin.client.rpc("create_company", {
      p_name: `Editable ${randomSuffix()}`,
      p_tax_id: null,
      p_is_default: false,
    });
    expect(createError).toBeNull();

    const { error: managerUpdateError } = await manager.client.rpc("update_company", {
      p_company_id: companyId,
      p_name: "Hijacked",
      p_tax_id: null,
      p_is_default: false,
    });
    expect(managerUpdateError).not.toBeNull();
    expect(managerUpdateError?.message).toMatch(/insufficient privileges/i);

    const { error: managerDeleteError } = await manager.client.rpc("delete_company", {
      p_company_id: companyId,
    });
    expect(managerDeleteError).not.toBeNull();
    expect(managerDeleteError?.message).toMatch(/insufficient privileges/i);

    const { error: updateError } = await admin.client.rpc("update_company", {
      p_company_id: companyId,
      p_name: "Renamed",
      p_tax_id: "B99999999",
      p_is_default: false,
    });
    expect(updateError).toBeNull();

    const { error: deleteError } = await admin.client.rpc("delete_company", {
      p_company_id: companyId,
    });
    expect(deleteError).toBeNull();
  });

  it("un org_admin no puede modificar una empresa de otra org", async () => {
    const { data: otherCompanyId, error: createError } = await otherOrgAdmin.client.rpc(
      "create_company",
      { p_name: `OrgB ${randomSuffix()}`, p_tax_id: null, p_is_default: false },
    );
    expect(createError).toBeNull();

    const { error: updateError } = await admin.client.rpc("update_company", {
      p_company_id: otherCompanyId,
      p_name: "Hijacked cross-org",
      p_tax_id: null,
      p_is_default: false,
    });
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toMatch(/company not found/i);

    const { error: deleteError } = await otherOrgAdmin.client.rpc("delete_company", {
      p_company_id: otherCompanyId,
    });
    expect(deleteError).toBeNull();
  });

  it("invariante de único default: marcar una segunda empresa como default desmarca la primera", async () => {
    const { data: firstId, error: firstError } = await admin.client.rpc("create_company", {
      p_name: `Default A ${randomSuffix()}`,
      p_tax_id: null,
      p_is_default: true,
    });
    expect(firstError).toBeNull();

    const { data: secondId, error: secondError } = await admin.client.rpc("create_company", {
      p_name: `Default B ${randomSuffix()}`,
      p_tax_id: null,
      p_is_default: true,
    });
    expect(secondError).toBeNull();

    const { data: first } = await admin.client
      .from("companies")
      .select("is_default")
      .eq("id", firstId)
      .single();
    const { data: second } = await admin.client
      .from("companies")
      .select("is_default")
      .eq("id", secondId)
      .single();

    expect(first?.is_default).toBe(false);
    expect(second?.is_default).toBe(true);
  });

  it.each([
    ["org_admin", () => admin],
    ["manager", () => manager],
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["employee", () => employee],
  ])("%s puede leer las empresas de su propia org", async (_role, getTenant) => {
    const { data, error } = await getTenant().client.from("companies").select("id");

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
