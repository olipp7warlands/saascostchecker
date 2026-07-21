import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

// Todas las fechas de este test caen en el mes siguiente al actual (nunca el
// mes por defecto que muestra el calendario al cargar) para que la
// navegación "mes siguiente" sea determinista sin importar qué día del mes
// se ejecute el test — evita el falso flake de un contrato "a 5 días" que
// cruza a otro mes según cuándo corra la suite.
function isoInNextMonth(day: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Tenant = { client: SupabaseClient; userId: string; email: string };

function newAnonClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signUpOrg(label: string): Promise<Tenant> {
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
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
  return { client, userId: data.user.id, email };
}

type ContractParams = {
  vendorName: string;
  renewalDate: string;
  autoRenews: boolean;
  cancellationNoticeDays: number;
  companyId: string | null;
};

async function createVendorWithContract(admin: Tenant, params: ContractParams) {
  const { data: vendorId, error: vendorError } = await admin.client.rpc("create_vendor", {
    p_catalog_id: null,
    p_name: params.vendorName,
    p_website: "example.test",
    p_category: "other",
    p_owner_user_id: null,
    p_is_custom: true,
    p_notes: null,
  });
  if (vendorError || !vendorId) throw vendorError ?? new Error("create_vendor failed");

  const { data: contractId, error: contractError } = await admin.client.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: `${params.vendorName} contract`,
    p_cost_amount: 100,
    p_currency: "EUR",
    p_billing_cycle: "annual",
    p_seats_purchased: null,
    p_start_date: isoInNextMonth(1),
    p_renewal_date: params.renewalDate,
    p_auto_renews: params.autoRenews,
    p_cancellation_notice_days: params.cancellationNoticeDays,
    p_document_url: null,
    p_department_id: null,
    p_company_id: params.companyId,
  });
  if (contractError || !contractId) throw contractError ?? new Error("create_contract failed");

  return { vendorId: vendorId as string, contractId: contractId as string };
}

async function cancelContract(admin: Tenant, contractId: string, params: ContractParams) {
  const { error } = await admin.client.rpc("update_contract", {
    p_contract_id: contractId,
    p_name: `${params.vendorName} contract`,
    p_cost_amount: 100,
    p_currency: "EUR",
    p_billing_cycle: "annual",
    p_seats_purchased: null,
    p_start_date: isoInNextMonth(1),
    p_renewal_date: params.renewalDate,
    p_auto_renews: params.autoRenews,
    p_cancellation_notice_days: params.cancellationNoticeDays,
    p_document_url: null,
    p_status: "cancelled",
    p_department_id: null,
    p_company_id: params.companyId,
  });
  if (error) throw error;
}

test.describe("Calendario de renovaciones (bloque 2.3)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("muestra los marcadores del mes, respeta el filtro de empresa y expone la agenda accesible", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const admin = await signUpOrg("renewals-admin");

    const { data: companyId, error: companyError } = await admin.client.rpc("create_company", {
      p_name: "Acme Holding",
      p_tax_id: null,
      p_is_default: false,
    });
    if (companyError || !companyId) throw companyError ?? new Error("create_company failed");

    // Auto-renueva sin preaviso -> un único marcador el día 10.
    const critical: ContractParams = {
      vendorName: "VendorCritical",
      renewalDate: isoInNextMonth(10),
      autoRenews: true,
      cancellationNoticeDays: 0,
      companyId,
    };
    await createVendorWithContract(admin, critical);

    // Auto-renueva con preaviso -> marcador accionable el día 5 (20-15) y
    // marcador informativo mudo el día 20 (fecha bruta de renovación).
    const notice: ContractParams = {
      vendorName: "VendorNotice",
      renewalDate: isoInNextMonth(20),
      autoRenews: true,
      cancellationNoticeDays: 15,
      companyId: null,
    };
    await createVendorWithContract(admin, notice);

    // No auto-renueva -> un único marcador el día 25, en la fecha de renovación.
    const manual: ContractParams = {
      vendorName: "VendorManual",
      renewalDate: isoInNextMonth(25),
      autoRenews: false,
      cancellationNoticeDays: 30,
      companyId: null,
    };
    await createVendorWithContract(admin, manual);

    // Cancelado: no debe aparecer en ningún sitio del calendario.
    const cancelled: ContractParams = {
      vendorName: "VendorCancelled",
      renewalDate: isoInNextMonth(12),
      autoRenews: false,
      cancellationNoticeDays: 30,
      companyId: null,
    };
    const { contractId: cancelledContractId } = await createVendorWithContract(admin, cancelled);
    await cancelContract(admin, cancelledContractId, cancelled);

    // --- Login real y navegación a /renewals ---
    await page.goto("/es/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    await page.goto("/es/renewals");
    await page.getByRole("button", { name: "Mes siguiente" }).click();

    // Rejilla: chips visibles con deep-link a la ficha del vendor.
    await expect(page.getByRole("link", { name: "VendorCritical", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "VendorCritical", exact: true })).toHaveAttribute(
      "href",
      new RegExp(`/es/vendors/.+#contract-.+`),
    );
    await expect(page.getByRole("link", { name: "VendorManual", exact: true })).toBeVisible();
    // VendorNotice aparece dos veces: marcador accionable (día 5) + informativo mudo (día 20).
    await expect(page.getByRole("link", { name: "VendorNotice", exact: true })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "VendorCancelled", exact: true })).toHaveCount(0);

    // Agenda accesible sr-only: misma información en forma de lista lineal.
    const agenda = page.locator(".sr-only", { hasText: "Agenda de renovaciones del mes" });
    await expect(agenda.getByRole("link", { name: /VendorCritical/ })).toBeVisible();
    await expect(agenda.getByRole("link", { name: /VendorManual/ })).toBeVisible();
    await expect(agenda.getByRole("link", { name: /VendorCancelled/ })).toHaveCount(0);

    // Filtro de empresa: solo VendorCritical (asignado a Acme Holding) queda visible.
    await page.getByRole("combobox", { name: "Todas las empresas" }).click();
    await page.getByRole("option", { name: "Acme Holding" }).click();

    await expect(page.getByRole("link", { name: "VendorCritical", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "VendorManual", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "VendorNotice", exact: true })).toHaveCount(0);
  });
});
