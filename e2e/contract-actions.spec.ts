import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

type Tenant = { client: SupabaseClient; email: string };

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
  return { client, email };
}

test.describe("Acciones sobre contratos (bloque 2.3b)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("marcar renegociado actualiza el contrato y el ahorro se refleja en la ficha y el dashboard", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const admin = await signUpOrg("contract-actions");

    const { data: vendorId, error: vendorError } = await admin.client.rpc("create_vendor", {
      p_catalog_id: null,
      p_name: "VendorToRenegotiate",
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_is_custom: true,
      p_notes: null,
    });
    if (vendorError || !vendorId) throw vendorError ?? new Error("create_vendor failed");

    const { error: contractError } = await admin.client.rpc("create_contract", {
      p_vendor_id: vendorId,
      p_name: "VendorToRenegotiate contract",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: null,
      p_start_date: futureDate(-30),
      p_renewal_date: futureDate(60),
      p_auto_renews: false,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_department_id: null,
      p_company_id: null,
    });
    if (contractError) throw contractError;

    // --- Login real ---
    await page.goto("/es/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    // --- Marcar renegociado desde la ficha del vendor ---
    await page.goto(`/es/vendors/${vendorId}`);
    await page.getByRole("tab", { name: "Contratos" }).click();
    await page.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: "Marcar renegociado" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Coste").fill("900");
    await page.getByRole("button", { name: "Guardar renegociación" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // El contrato refleja el nuevo coste. Texto completo de la subfila del
    // contrato ("900 € · Anual"), no "900 €" a secas — ese substring también
    // matchea el número grande de "Coste anual" en VendorRail (siempre
    // visible en la barra lateral, sin importar la pestaña activa).
    await expect(page.getByText("900 € · Anual")).toBeVisible();

    // La tarjeta de ahorro de la ficha del vendor refleja el ahorro (1200-900=300).
    const railSavingsCard = page.getByText("Ahorro conseguido", { exact: true }).locator("..");
    await expect(railSavingsCard.getByText("300 €", { exact: true })).toBeVisible();

    // --- El KPI del dashboard agrega el mismo ahorro ---
    await page.goto("/es/dashboard");
    const kpiCard = page.getByText("Ahorro conseguido", { exact: true }).locator("..");
    await expect(kpiCard.getByText("300 €", { exact: true })).toBeVisible();
  });
});
