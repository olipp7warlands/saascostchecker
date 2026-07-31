// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Bloque 3.3 — record_purchase_request_conversion(). Crea orgs/usuarios/
// vendors reales. Solo debe correr contra la instancia LOCAL de Supabase.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`conversion.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`);
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

function createRequestParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    // Coste bajo (< 500) cae en el tier "auto" del seed por defecto — la
    // solicitud queda 'approved' en la misma transacción de creación, sin
    // necesitar montar el ciclo completo de aprobación para estos tests.
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

async function createVendor(caller: TestTenant, name: string, catalogId: string | null = null) {
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

async function createContract(caller: TestTenant, vendorId: string) {
  const { data: contractId, error } = await caller.client.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: "Test contract",
    p_cost_amount: 100,
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
  });
  if (error || !contractId) throw error ?? new Error("create_contract did not return an id");
  return contractId as string;
}

describe("record_purchase_request_conversion (bloque 3.3)", () => {
  let admin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;

  beforeAll(async () => {
    admin = await signUpOrg("conv-admin");
    employee = await inviteAndAccept(admin, "employee", "conv-emp");
    otherOrgAdmin = await signUpOrg("conv-other");
  });

  it("enlaza vendor+contrato existentes a una solicitud aprobada, y escribe audit_log", async () => {
    const { data: requestId } = await admin.client.rpc("create_purchase_request", createRequestParams());
    const vendorId = await createVendor(admin, "Linked Vendor");
    const contractId = await createContract(admin, vendorId);

    const { error } = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: contractId,
    });
    expect(error).toBeNull();

    const { data: request } = await admin.client
      .from("purchase_requests")
      .select("converted_vendor_id, converted_contract_id")
      .eq("id", requestId)
      .single();
    expect(request?.converted_vendor_id).toBe(vendorId);
    expect(request?.converted_contract_id).toBe(contractId);

    const { data: contract } = await admin.client
      .from("contracts")
      .select("source_request_id")
      .eq("id", contractId)
      .single();
    expect(contract?.source_request_id).toBe(requestId);

    const { data: auditRows } = await serviceRole
      .from("audit_log")
      .select("action, diff")
      .eq("entity_id", requestId)
      .eq("action", "purchase_request.converted");
    expect(auditRows).toHaveLength(1);
    expect(auditRows?.[0]?.diff).toMatchObject({ vendor_id: vendorId, contract_id: contractId });
  });

  it("guarda anti-doble-conversión: una segunda llamada sobre la misma solicitud falla", async () => {
    const { data: requestId } = await admin.client.rpc("create_purchase_request", createRequestParams());
    const vendorId = await createVendor(admin, "First Vendor");
    const contractId = await createContract(admin, vendorId);

    const first = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: contractId,
    });
    expect(first.error).toBeNull();

    const secondVendorId = await createVendor(admin, "Second Vendor");
    const secondContractId = await createContract(admin, secondVendorId);

    const second = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: secondVendorId,
      p_contract_id: secondContractId,
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/already_converted/);

    // El primer enlace no se pisó por el segundo intento fallido.
    const { data: request } = await admin.client
      .from("purchase_requests")
      .select("converted_vendor_id, converted_contract_id")
      .eq("id", requestId)
      .single();
    expect(request?.converted_vendor_id).toBe(vendorId);
    expect(request?.converted_contract_id).toBe(contractId);
  });

  it("un empleado (no finance/it_admin/org_admin) no puede convertir", async () => {
    const { data: requestId } = await employee.client.rpc("create_purchase_request", createRequestParams());
    const vendorId = await createVendor(admin, "Employee Blocked Vendor");
    const contractId = await createContract(admin, vendorId);

    const { error } = await employee.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: contractId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/);
  });

  it("una solicitud que no está approved no se puede convertir", async () => {
    // Coste alto: cae en un tier no-auto, la solicitud queda 'pending'.
    const { data: requestId } = await admin.client.rpc(
      "create_purchase_request",
      createRequestParams({ p_estimated_annual_cost: 8000 }),
    );
    const vendorId = await createVendor(admin, "Pending Request Vendor");
    const contractId = await createContract(admin, vendorId);

    const { error } = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: contractId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not approved/);
  });

  it("rechaza un contrato que no pertenece al vendor indicado", async () => {
    const { data: requestId } = await admin.client.rpc("create_purchase_request", createRequestParams());
    const vendorA = await createVendor(admin, "Vendor A");
    const vendorB = await createVendor(admin, "Vendor B");
    const contractOfB = await createContract(admin, vendorB);

    const { error } = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorA,
      p_contract_id: contractOfB,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/does not belong to the given vendor/);
  });

  it("rechaza un vendor/contrato de otra organización", async () => {
    const { data: requestId } = await admin.client.rpc("create_purchase_request", createRequestParams());
    const foreignVendorId = await createVendor(otherOrgAdmin, "Foreign Vendor");
    const foreignContractId = await createContract(otherOrgAdmin, foreignVendorId);

    const { error } = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: foreignVendorId,
      p_contract_id: foreignContractId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/vendor not found/);
  });

  // Instrucción del usuario tras aprobar el diseño: sin transacciones
  // distribuidas entre create_vendor/create_contract y el enlace — si el
  // enlace falla, el vendor/contrato quedan creados igualmente y una llamada
  // posterior con los ids correctos completa la conversión (enlazable a
  // posteriori, sin recrear nada).
  it("si el enlace falla tras crear vendor+contrato, ambos quedan creados y una llamada posterior con los ids correctos completa el enlace", async () => {
    const { data: requestId } = await admin.client.rpc("create_purchase_request", createRequestParams());
    const vendorId = await createVendor(admin, "Recoverable Vendor");
    const contractId = await createContract(admin, vendorId);

    const wrongContractId = "00000000-0000-0000-0000-000000000000";
    const failedAttempt = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: wrongContractId,
    });
    expect(failedAttempt.error).not.toBeNull();

    // El vendor y el contrato reales siguen existiendo tal cual se crearon.
    const { data: vendorRow } = await admin.client.from("vendors").select("id").eq("id", vendorId).single();
    expect(vendorRow?.id).toBe(vendorId);
    const { data: contractRow } = await admin.client
      .from("contracts")
      .select("id, source_request_id")
      .eq("id", contractId)
      .single();
    expect(contractRow?.id).toBe(contractId);
    expect(contractRow?.source_request_id).toBeNull();

    // La solicitud sigue sin convertir tras el fallo.
    const { data: requestAfterFailure } = await admin.client
      .from("purchase_requests")
      .select("converted_contract_id")
      .eq("id", requestId)
      .single();
    expect(requestAfterFailure?.converted_contract_id).toBeNull();

    // Enlace posterior con los ids correctos: recupera el estado sin recrear nada.
    const recovered = await admin.client.rpc("record_purchase_request_conversion", {
      p_request_id: requestId,
      p_vendor_id: vendorId,
      p_contract_id: contractId,
    });
    expect(recovered.error).toBeNull();

    const { data: requestAfterRecovery } = await admin.client
      .from("purchase_requests")
      .select("converted_vendor_id, converted_contract_id")
      .eq("id", requestId)
      .single();
    expect(requestAfterRecovery?.converted_vendor_id).toBe(vendorId);
    expect(requestAfterRecovery?.converted_contract_id).toBe(contractId);
  });

  it("detección de vendor ya existente: un vendor creado desde un catalog_id es visible al filtrar por ese mismo catalog_id, y no se filtra entre orgs", async () => {
    const { data: catalogEntry } = await serviceRole.from("saas_catalog").select("id").limit(1).single();
    if (!catalogEntry) throw new Error("saas_catalog seed vacío — no se puede probar el match por catalog_id");

    const vendorId = await createVendor(admin, "Catalog Matched Vendor", catalogEntry.id);

    const { data: matches } = await admin.client
      .from("vendors")
      .select("id")
      .eq("catalog_id", catalogEntry.id);
    expect(matches?.some((row) => row.id === vendorId)).toBe(true);

    const { data: foreignMatches } = await otherOrgAdmin.client
      .from("vendors")
      .select("id")
      .eq("catalog_id", catalogEntry.id);
    expect(foreignMatches?.some((row) => row.id === vendorId)).toBe(false);
  });
});
