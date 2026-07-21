import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

test.describe("Presupuestos por bolsa (bloque nuevo: tags + presupuestos)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("crear una bolsa desde la UI y ver la barra de consumo con semáforo crítico", async ({
    page,
  }) => {
    const setupClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `budget-flow-${suffix}@example.test`;
    const password = "Test1234!";
    const departmentName = `Marketing ${suffix}`;
    const currentYear = new Date().getFullYear();

    const { error: signUpError } = await setupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "Budget Flow",
          org_name: `Budget Flow Org ${suffix}`,
          org_slug: `budget-flow-${suffix}`,
          default_currency: "EUR",
          locale: "es",
        },
      },
    });
    expect(signUpError).toBeNull();

    const { data: departmentId, error: departmentError } = await setupClient.rpc(
      "create_department",
      { p_name: departmentName, p_manager_user_id: null },
    );
    expect(departmentError).toBeNull();

    const { data: vendorId, error: vendorError } = await setupClient.rpc("create_vendor", {
      p_catalog_id: null,
      p_name: `Budget Vendor ${suffix}`,
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_is_custom: true,
      p_notes: null,
    });
    expect(vendorError).toBeNull();

    const { error: contractError } = await setupClient.rpc("create_contract", {
      p_vendor_id: vendorId,
      p_name: "Contract",
      p_cost_amount: 100,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: null,
      p_start_date: isoDate(-30),
      p_renewal_date: isoDate(300),
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_department_id: departmentId,
      p_company_id: null,
    });
    expect(contractError).toBeNull();

    // Gasto RECONCILIADO real (vendor_id is not null) por el camino de
    // producción: import_spend_records() (crea el spend_record + la fila en
    // reconciliation_queue) + link_reconciliation() (le asigna el vendor) —
    // mismo flujo que ejercita el bloque 1.3, no un insert directo.
    const rawDescription = `BUDGET E2E ${suffix}`;
    const { data: batchId, error: batchError } = await setupClient.rpc("create_import_batch", {
      p_original_filename: "budget-e2e.csv",
      p_delimiter: ",",
      p_encoding: "utf-8",
      p_has_header: true,
    });
    expect(batchError).toBeNull();

    const { error: importError } = await setupClient.rpc("import_spend_records", {
      p_batch_id: batchId,
      p_records: [
        { date: isoDate(-5), amount: 150, currency: "EUR", raw_description: rawDescription },
      ],
      p_error_count: 0,
      p_has_header: true,
    });
    expect(importError).toBeNull();

    const { data: queueRows, error: queueError } = await setupClient
      .from("reconciliation_queue")
      .select("id, spend_records(raw_description)")
      .eq("status", "pending");
    expect(queueError).toBeNull();
    const queueRow = (queueRows ?? []).find(
      (row) =>
        (Array.isArray(row.spend_records) ? row.spend_records[0] : row.spend_records)
          ?.raw_description === rawDescription,
    );
    expect(queueRow).toBeTruthy();

    const { error: linkError } = await setupClient.rpc("link_reconciliation", {
      p_queue_id: queueRow!.id,
      p_vendor_id: vendorId,
      p_catalog_id: null,
    });
    expect(linkError).toBeNull();

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    // Crear la bolsa desde la UI: 150€ de gasto reconciliado vs. 100€ de
    // presupuesto (150% consumido) es SIEMPRE crítico, sin importar en qué
    // día del año fiscal corra el test (ver budgetTone: >=100% consumido es
    // crítico incondicionalmente).
    await page.goto("/es/team/budgets");
    await page.getByLabel("Departamento").selectOption({ label: departmentName });
    await page.getByLabel("Año fiscal").fill(String(currentYear));
    await page.getByLabel("Importe").fill("100");
    await page.getByLabel("Moneda").fill("EUR");
    await page.getByRole("button", { name: "Crear bolsa" }).click();

    const bucket = page.locator("li").filter({ hasText: `${departmentName} — todas las empresas` });
    await expect(bucket.getByText("Crítico")).toBeVisible();
    // Texto exacto de la línea "consumido / presupuestado" — evita
    // ambigüedad con el "150 €" del desglose de vendors (mismo bucket,
    // colapsado mediante <details> pero presente en el DOM).
    await expect(bucket.getByText("150 € / 100 €", { exact: true })).toBeVisible();

    // Resumen discreto del dashboard también refleja el peor semáforo.
    // Regex más específica que "Presupuesto" a secas: el nav lateral tiene
    // un link "Presupuestos" (plural) que también matchearía por substring.
    await page.goto("/es/dashboard");
    await expect(page.getByRole("link", { name: /% consumido/ })).toContainText("Crítico");
  });
});
