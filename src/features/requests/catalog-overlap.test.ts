// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogOverlapRpcRow } from "./catalog-overlap";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Bloque 3.4 — check_catalog_overlap() / known_overlap. Crea orgs/usuarios/
// vendors reales. Solo debe correr contra la instancia LOCAL de Supabase.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`catalog-overlap.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`);
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

async function createVendor(caller: TestTenant, name: string, catalogId: string | null) {
  const { data: vendorId, error } = await caller.client.rpc("create_vendor", {
    p_catalog_id: catalogId,
    p_name: name,
    p_website: "example.com",
    p_category: "other",
    p_owner_user_id: null,
    p_is_custom: catalogId === null,
    p_notes: null,
  });
  if (error || !vendorId) throw error ?? new Error("create_vendor did not return an id");
  return vendorId as string;
}

async function createContract(caller: TestTenant, vendorId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const { data: contractId, error } = await caller.client.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: "Test contract",
    p_cost_amount: 1200,
    p_currency: "EUR",
    p_billing_cycle: "annual",
    p_seats_purchased: 5,
    p_start_date: "2026-01-01",
    p_renewal_date: "2027-01-01",
    p_auto_renews: true,
    p_cancellation_notice_days: 30,
    p_document_url: null,
    p_department_id: null,
    p_company_id: null,
    ...overrides,
  });
  if (error || !contractId) throw error ?? new Error("create_contract did not return an id");
  return contractId as string;
}

// El cliente de Supabase de este proyecto no usa un generic Database (ver
// src/lib/supabase/server.ts), así que `.rpc(...).single()` infiere `{}` —
// cast explícito en un único sitio en vez de repetirlo en cada test.
async function checkOverlap(client: SupabaseClient, catalogId: string) {
  const { data, error } = await client.rpc("check_catalog_overlap", { p_catalog_id: catalogId }).single();
  return { data: data as CatalogOverlapRpcRow | null, error };
}

function createRequestParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    p_catalog_id: null,
    p_vendor_name: "Test Tool",
    p_estimated_annual_cost: 100,
    p_currency: "EUR",
    p_department_id: null,
    p_justification: "Justificación de prueba con longitud suficiente.",
    p_alternatives_considered: null,
    ...overrides,
  };
}

describe("check_catalog_overlap() / known_overlap (bloque 3.4)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;
  // vendors_org_catalog_id_unique_idx (bloque 1.3) permite como máximo UN
  // vendor por (org, catalog_id) — cada test que crea un vendor necesita su
  // propio catalog_id distinto, no uno compartido, o choca contra ese índice
  // en cuanto un segundo test intenta enlazar el mismo catalog_id en la
  // misma org (descubierto por el propio CI, no visto en verificación manual
  // porque cada escenario se probó allí con una org efímera propia).
  let catalogIds: string[];

  beforeAll(async () => {
    admin = await signUpOrg("ovl-admin");
    employee = await inviteAndAccept(admin, "employee", "ovl-emp");
    otherOrgAdmin = await signUpOrg("ovl-other");

    const { data: catalogEntries } = await admin.client
      .from("saas_catalog")
      .select("id")
      .order("name", { ascending: true })
      .range(0, 5);
    if (!catalogEntries || catalogEntries.length < 6) {
      throw new Error("saas_catalog seed insuficiente — no se puede probar check_catalog_overlap");
    }
    catalogIds = catalogEntries.map((row) => row.id);
  });

  it("sin vendor con ese catalog_id: has_overlap false, sin contratos", async () => {
    const { data, error } = await checkOverlap(admin.client, catalogIds[0]);
    expect(error).toBeNull();
    expect(data?.has_overlap).toBe(false);
    expect(data?.active_contract_count).toBe(0);
    expect(data?.contracts).toEqual([]);
  });

  it("catalog_id inexistente: la RPC falla en vez de devolver un falso 'sin solapamiento'", async () => {
    const { error } = await admin.client
      .rpc("check_catalog_overlap", { p_catalog_id: "00000000-0000-0000-0000-000000000000" })
      .single();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/catalog_id not found/);
  });

  it("MANAGER_ROLES (org_admin) ve importes; un empleado NO recibe importes en el payload (solo existencia/vendor/depto/owner/nº contratos)", async () => {
    const vendorId = await createVendor(admin, "Overlap Vendor", catalogIds[1]);
    await createContract(admin, vendorId, { p_cost_amount: 2400 });

    const managerView = await checkOverlap(admin.client, catalogIds[1]);
    expect(managerView.error).toBeNull();
    expect(managerView.data?.has_overlap).toBe(true);
    expect(managerView.data?.active_contract_count).toBe(1);
    expect(managerView.data?.contracts?.[0].cost_amount).not.toBeNull();
    expect(Number(managerView.data?.contracts?.[0].cost_amount)).toBe(2400);
    expect(managerView.data?.contracts?.[0].currency).toBe("EUR");
    expect(managerView.data?.contracts?.[0].vendor_name).toBe("Overlap Vendor");

    const employeeView = await checkOverlap(employee.client, catalogIds[1]);
    expect(employeeView.error).toBeNull();
    expect(employeeView.data?.has_overlap).toBe(true);
    expect(employeeView.data?.active_contract_count).toBe(1);
    // Verifica el payload en crudo, no solo lo que la UI decidiría mostrar:
    // un empleado no debe recibir cost_amount/currency/billing_cycle.
    expect(employeeView.data?.contracts?.[0].cost_amount).toBeNull();
    expect(employeeView.data?.contracts?.[0].currency).toBeNull();
    expect(employeeView.data?.contracts?.[0].billing_cycle).toBeNull();
    expect(employeeView.data?.contracts?.[0].vendor_name).toBe("Overlap Vendor");
  });

  it("un contrato cancelado no cuenta como solapamiento (vendor sigue activo)", async () => {
    const vendorId = await createVendor(admin, "Cancelled Contract Vendor", catalogIds[2]);
    const contractId = await createContract(admin, vendorId);
    await admin.client.rpc("update_contract", {
      p_contract_id: contractId,
      p_name: "Test contract",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: 5,
      p_start_date: "2026-01-01",
      p_renewal_date: "2027-01-01",
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_status: "cancelled",
    });

    const { data } = await checkOverlap(admin.client, catalogIds[2]);
    expect(data?.has_overlap).toBe(false);
    expect(data?.contracts).toEqual([]);
  });

  it("un vendor inactivo no cuenta como solapamiento aunque su contrato siga activo", async () => {
    const vendorId = await createVendor(admin, "Inactive Vendor", catalogIds[3]);
    await createContract(admin, vendorId);
    await admin.client.rpc("update_vendor", {
      p_vendor_id: vendorId,
      p_name: "Inactive Vendor",
      p_website: "example.com",
      p_category: "other",
      p_owner_user_id: null,
      p_status: "inactive",
      p_notes: null,
    });

    const { data } = await checkOverlap(admin.client, catalogIds[3]);
    expect(data?.has_overlap).toBe(false);
    expect(data?.contracts).toEqual([]);
  });

  it("no es enumerable contra otra org: el mismo catalog_id con vendor en la org A no aparece para la org B", async () => {
    const vendorId = await createVendor(admin, "Org A Only Vendor", catalogIds[4]);
    await createContract(admin, vendorId);

    const { data } = await checkOverlap(otherOrgAdmin.client, catalogIds[4]);
    expect(data?.has_overlap).toBe(false);
    expect(data?.contracts).toEqual([]);
  });

  it("create_purchase_request calcula known_overlap server-side (no es un valor que el cliente pueda afirmar)", async () => {
    const vendorId = await createVendor(admin, "Known Overlap Vendor", catalogIds[5]);
    await createContract(admin, vendorId);

    const { data: overlappingRequestId } = await admin.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_catalog_id: catalogIds[5], p_estimated_annual_cost: 8000 }),
    );
    const { data: overlappingRequest } = await admin.client
      .from("purchase_requests")
      .select("known_overlap")
      .eq("id", overlappingRequestId)
      .single();
    expect(overlappingRequest?.known_overlap).toBe(true);

    const { data: cleanRequestId } = await admin.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_catalog_id: null, p_estimated_annual_cost: 8000 }),
    );
    const { data: cleanRequest } = await admin.client
      .from("purchase_requests")
      .select("known_overlap")
      .eq("id", cleanRequestId)
      .single();
    expect(cleanRequest?.known_overlap).toBe(false);
  });
});
