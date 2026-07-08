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
