// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Este test crea usuarios/orgs reales vía signUp()/RPCs. Solo debe correr
// contra la instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `permissions.test.ts (vendors) apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
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

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function createVendor(tenant: TestTenant, name: string) {
  const { data, error } = await tenant.client.rpc("create_vendor", {
    p_catalog_id: null,
    p_name: name,
    p_website: "example.test",
    p_category: "other",
    p_owner_user_id: null,
    p_is_custom: true,
    p_notes: null,
  });
  return { vendorId: data as string | null, error };
}

async function createContractForVendor(tenant: TestTenant, vendorId: string) {
  const { data, error } = await tenant.client.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: "Contract",
    p_cost_amount: 1200,
    p_currency: "EUR",
    p_billing_cycle: "annual",
    p_seats_purchased: 10,
    p_start_date: futureDate(-30),
    p_renewal_date: futureDate(300),
    p_auto_renews: true,
    p_cancellation_notice_days: 30,
    p_document_url: null,
  });
  return { contractId: data as string | null, error };
}

async function createCompanyForOrg(tenant: TestTenant, name: string) {
  const { data, error } = await tenant.client.rpc("create_company", {
    p_name: name,
    p_tax_id: null,
    p_is_default: false,
  });
  return { companyId: data as string | null, error };
}

describe("Permisos de vendors/contratos de SPECS §5 (bloque 1.2)", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let finance: TestTenant;
  let itAdmin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;

  beforeAll(async () => {
    admin = await signUpOrg("vend-admin");

    [manager, finance, itAdmin, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "vend-manager"),
      inviteAndAccept(admin, "finance", "vend-finance"),
      inviteAndAccept(admin, "it_admin", "vend-itadmin"),
      inviteAndAccept(admin, "employee", "vend-employee"),
    ]);

    otherOrgAdmin = await signUpOrg("vend-other");
  });

  it.each([
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["org_admin", () => admin],
  ])("%s puede crear un vendor", async (_role, getTenant) => {
    const { vendorId, error } = await createVendor(getTenant(), `Vendor ${randomSuffix()}`);
    expect(error).toBeNull();
    expect(vendorId).toBeTruthy();
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede crear un vendor", async (_role, getTenant) => {
    const { error } = await createVendor(getTenant(), `Blocked ${randomSuffix()}`);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s no ve ningún vendor de su propia org (RLS por rol, no solo por org)", async (_role, getTenant) => {
    await createVendor(admin, `Visible-check ${randomSuffix()}`);
    const { data, error } = await getTenant().client.from("vendors").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("finance/it_admin/org_admin sí ven los vendors de su org", async () => {
    const { vendorId } = await createVendor(admin, `Readable ${randomSuffix()}`);
    for (const tenant of [finance, itAdmin, admin]) {
      const { data, error } = await tenant.client.from("vendors").select("id").eq("id", vendorId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });

  it("crear un vendor escribe en audit_log", async () => {
    const name = `Audited ${randomSuffix()}`;
    const { vendorId } = await createVendor(finance, name);

    const { data: entries, error } = await admin.client
      .from("audit_log")
      .select("action, entity, entity_id, actor_id")
      .eq("entity_id", vendorId)
      .eq("action", "vendor.created");

    expect(error).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.entity).toBe("vendor");
  });

  it("actualizar y borrar un vendor: finance puede, manager no puede ninguna de las dos", async () => {
    const { vendorId } = await createVendor(admin, `Editable ${randomSuffix()}`);

    const { error: managerUpdateError } = await manager.client.rpc("update_vendor", {
      p_vendor_id: vendorId,
      p_name: "Hijacked",
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_status: "active",
      p_notes: null,
    });
    expect(managerUpdateError).not.toBeNull();
    expect(managerUpdateError?.message).toMatch(/insufficient privileges/i);

    const { error: updateError } = await finance.client.rpc("update_vendor", {
      p_vendor_id: vendorId,
      p_name: "Renamed",
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_status: "active",
      p_notes: null,
    });
    expect(updateError).toBeNull();

    const { error: managerDeleteError } = await manager.client.rpc("delete_vendor", {
      p_vendor_id: vendorId,
    });
    expect(managerDeleteError).not.toBeNull();
    expect(managerDeleteError?.message).toMatch(/insufficient privileges/i);

    const { error: deleteError } = await finance.client.rpc("delete_vendor", {
      p_vendor_id: vendorId,
    });
    expect(deleteError).toBeNull();
  });

  it("borrar un vendor con contratos falla con un error claro (FK restrict, no cascade)", async () => {
    const { vendorId } = await createVendor(admin, `WithContract ${randomSuffix()}`);
    const { contractId, error: contractError } = await createContractForVendor(admin, vendorId!);
    expect(contractError).toBeNull();
    expect(contractId).toBeTruthy();

    const { error: deleteError } = await admin.client.rpc("delete_vendor", {
      p_vendor_id: vendorId,
    });
    expect(deleteError).not.toBeNull();
    expect(deleteError?.message).toMatch(/foreign key|violat/i);
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede crear un contrato", async (_role, getTenant) => {
    const { vendorId } = await createVendor(admin, `ForContract ${randomSuffix()}`);
    const { error } = await createContractForVendor(getTenant(), vendorId!);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("crear un contrato escribe en audit_log", async () => {
    const { vendorId } = await createVendor(admin, `ContractAudit ${randomSuffix()}`);
    const { contractId, error } = await createContractForVendor(itAdmin, vendorId!);
    expect(error).toBeNull();

    const { data: entries, error: auditError } = await admin.client
      .from("audit_log")
      .select("action, entity")
      .eq("entity_id", contractId)
      .eq("action", "contract.created");

    expect(auditError).toBeNull();
    expect(entries).toHaveLength(1);
  });

  it("create_contract/update_contract rechazan un company_id de otra org (soporte multi-empresa, 2026-07-16)", async () => {
    const { vendorId } = await createVendor(admin, `CompanyScoped ${randomSuffix()}`);
    const { companyId: otherCompanyId, error: companyError } = await createCompanyForOrg(
      otherOrgAdmin,
      `OrgB Co ${randomSuffix()}`,
    );
    expect(companyError).toBeNull();

    const { data: contractId, error: createError } = await admin.client.rpc("create_contract", {
      p_vendor_id: vendorId,
      p_name: "Contract",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: 10,
      p_start_date: futureDate(-30),
      p_renewal_date: futureDate(300),
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_department_id: null,
      p_company_id: otherCompanyId,
    });
    expect(createError).not.toBeNull();
    expect(createError?.message).toMatch(/company_id does not belong/i);
    expect(contractId).toBeNull();

    const { contractId: validContractId, error: validCreateError } = await createContractForVendor(
      admin,
      vendorId!,
    );
    expect(validCreateError).toBeNull();

    const { error: updateError } = await admin.client.rpc("update_contract", {
      p_contract_id: validContractId,
      p_name: "Contract",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: 10,
      p_start_date: futureDate(-30),
      p_renewal_date: futureDate(300),
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_status: "active",
      p_department_id: null,
      p_company_id: otherCompanyId,
    });
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toMatch(/company_id does not belong/i);
  });

  it("un org_admin no puede leer/editar/borrar un vendor de otra org", async () => {
    const { vendorId } = await createVendor(otherOrgAdmin, `OrgB ${randomSuffix()}`);

    const { data: crossOrgRead, error: readError } = await admin.client
      .from("vendors")
      .select("id")
      .eq("id", vendorId);
    expect(readError).toBeNull();
    expect(crossOrgRead).toEqual([]);

    const { error: updateError } = await admin.client.rpc("update_vendor", {
      p_vendor_id: vendorId,
      p_name: "Hijacked cross-org",
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_status: "active",
      p_notes: null,
    });
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toMatch(/vendor not found/i);

    const { error: deleteError } = await admin.client.rpc("delete_vendor", {
      p_vendor_id: vendorId,
    });
    expect(deleteError).not.toBeNull();
    expect(deleteError?.message).toMatch(/vendor not found/i);
  });
});

// assign_seat espera el id de la fila public.users (no el auth_id que
// TestTenant.userId guarda) — se resuelve vía el propio cliente del tenant,
// visible por la RLS estándar de users (org_id = current_org_id()).
async function publicUserId(tenant: TestTenant): Promise<string> {
  const { data, error } = await tenant.client
    .from("users")
    .select("id")
    .eq("auth_id", tenant.userId)
    .single();
  if (error || !data) throw error ?? new Error("public user row not found");
  return data.id as string;
}

async function assignSeatRpc(tenant: TestTenant, contractId: string, userId: string) {
  const { data, error } = await tenant.client.rpc("assign_seat", {
    p_contract_id: contractId,
    p_user_id: userId,
  });
  const row = (Array.isArray(data) ? data[0] : null) as
    | { seat_id: string; over_capacity: boolean }
    | null;
  return { seatId: row?.seat_id ?? null, overCapacity: row?.over_capacity ?? null, error };
}

describe("Permisos de seat_assignments (bloque 1.4)", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let finance: TestTenant;
  let itAdmin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;
  let employeePublicId: string;
  let managerPublicId: string;

  beforeAll(async () => {
    admin = await signUpOrg("seat-admin");

    [manager, finance, itAdmin, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "seat-manager"),
      inviteAndAccept(admin, "finance", "seat-finance"),
      inviteAndAccept(admin, "it_admin", "seat-itadmin"),
      inviteAndAccept(admin, "employee", "seat-employee"),
    ]);

    otherOrgAdmin = await signUpOrg("seat-other");

    [employeePublicId, managerPublicId] = await Promise.all([
      publicUserId(employee),
      publicUserId(manager),
    ]);
  });

  async function createContractWithSeats(seatsPurchased: number | null) {
    const { vendorId } = await createVendor(admin, `Seats ${randomSuffix()}`);
    const { data, error } = await admin.client.rpc("create_contract", {
      p_vendor_id: vendorId,
      p_name: "Contract",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: seatsPurchased,
      p_start_date: futureDate(-30),
      p_renewal_date: futureDate(300),
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
    });
    if (error || !data) throw error ?? new Error("could not create contract");
    return { vendorId: vendorId as string, contractId: data as string };
  }

  it.each([
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["org_admin", () => admin],
  ])("%s puede asignar un asiento", async (_role, getTenant) => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId, error } = await assignSeatRpc(getTenant(), contractId, employeePublicId);
    expect(error).toBeNull();
    expect(seatId).toBeTruthy();
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede asignar un asiento", async (_role, getTenant) => {
    const { contractId } = await createContractWithSeats(10);
    const { error } = await assignSeatRpc(getTenant(), contractId, employeePublicId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("asignar un asiento escribe en audit_log", async () => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId, error } = await assignSeatRpc(finance, contractId, managerPublicId);
    expect(error).toBeNull();

    const { data: entries, error: auditError } = await admin.client
      .from("audit_log")
      .select("action, entity")
      .eq("entity_id", seatId)
      .eq("action", "seat_assignment.created");

    expect(auditError).toBeNull();
    expect(entries).toHaveLength(1);
  });

  it("no se puede asignar el mismo usuario dos veces al mismo contrato", async () => {
    const { contractId } = await createContractWithSeats(10);
    const first = await assignSeatRpc(finance, contractId, employeePublicId);
    expect(first.error).toBeNull();

    const second = await assignSeatRpc(finance, contractId, employeePublicId);
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/already has a seat/i);
  });

  it("asignar más asientos que seats_purchased devuelve over_capacity y lo registra en audit_log", async () => {
    const { contractId } = await createContractWithSeats(1);
    const first = await assignSeatRpc(finance, contractId, employeePublicId);
    expect(first.error).toBeNull();
    expect(first.overCapacity).toBe(false);

    const second = await assignSeatRpc(finance, contractId, managerPublicId);
    expect(second.error).toBeNull();
    expect(second.overCapacity).toBe(true);

    const { data: entries } = await admin.client
      .from("audit_log")
      .select("diff")
      .eq("entity_id", second.seatId)
      .eq("action", "seat_assignment.created");
    expect(entries?.[0]?.diff?.over_capacity).toBe(true);
  });

  it("un contrato sin seats_purchased nunca marca over_capacity", async () => {
    const { contractId } = await createContractWithSeats(null);
    const { error, overCapacity } = await assignSeatRpc(finance, contractId, employeePublicId);
    expect(error).toBeNull();
    expect(overCapacity).toBe(false);
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede marcar un asiento como inactivo/activo", async (_role, getTenant) => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId } = await assignSeatRpc(finance, contractId, employeePublicId);

    const { error } = await getTenant().client.rpc("set_seat_active", {
      p_seat_id: seatId,
      p_active: false,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("finance puede marcar un asiento inactivo y luego activo de nuevo, con audit_log en cada cambio", async () => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId } = await assignSeatRpc(finance, contractId, employeePublicId);

    const { error: inactiveError } = await finance.client.rpc("set_seat_active", {
      p_seat_id: seatId,
      p_active: false,
    });
    expect(inactiveError).toBeNull();

    const { data: seatAfterInactive } = await admin.client
      .from("seat_assignments")
      .select("last_seen_active_at")
      .eq("id", seatId)
      .single();
    expect(seatAfterInactive?.last_seen_active_at).toBeNull();

    const { error: activeError } = await finance.client.rpc("set_seat_active", {
      p_seat_id: seatId,
      p_active: true,
    });
    expect(activeError).toBeNull();

    const { data: seatAfterActive } = await admin.client
      .from("seat_assignments")
      .select("last_seen_active_at")
      .eq("id", seatId)
      .single();
    expect(seatAfterActive?.last_seen_active_at).not.toBeNull();

    const { data: entries } = await admin.client
      .from("audit_log")
      .select("action")
      .eq("entity_id", seatId)
      .eq("action", "seat_assignment.updated");
    expect(entries).toHaveLength(2);
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede quitar un asiento", async (_role, getTenant) => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId } = await assignSeatRpc(finance, contractId, employeePublicId);

    const { error } = await getTenant().client.rpc("unassign_seat", { p_seat_id: seatId });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("finance puede quitar un asiento y queda registrado en audit_log", async () => {
    const { contractId } = await createContractWithSeats(10);
    const { seatId } = await assignSeatRpc(finance, contractId, employeePublicId);

    const { error } = await finance.client.rpc("unassign_seat", { p_seat_id: seatId });
    expect(error).toBeNull();

    const { data: entries } = await admin.client
      .from("audit_log")
      .select("action")
      .eq("entity_id", seatId)
      .eq("action", "seat_assignment.deleted");
    expect(entries).toHaveLength(1);
  });

  it("un org_admin no puede asignar ni quitar asientos de un contrato de otra org", async () => {
    const { contractId } = await createContractWithSeats(10);

    const { error: assignError } = await assignSeatRpc(otherOrgAdmin, contractId, employeePublicId);
    expect(assignError).not.toBeNull();
    expect(assignError?.message).toMatch(/contract not found/i);

    const { seatId } = await assignSeatRpc(finance, contractId, employeePublicId);
    const { error: unassignError } = await otherOrgAdmin.client.rpc("unassign_seat", {
      p_seat_id: seatId,
    });
    expect(unassignError).not.toBeNull();
    expect(unassignError?.message).toMatch(/seat assignment not found/i);
  });

  it("manager/employee no ven ningún seat_assignment de su propia org (RLS por rol)", async () => {
    const { contractId } = await createContractWithSeats(10);
    await assignSeatRpc(finance, contractId, employeePublicId);

    for (const tenant of [manager, employee]) {
      const { data, error } = await tenant.client.from("seat_assignments").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});
