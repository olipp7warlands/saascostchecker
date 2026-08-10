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

async function inviteAndAccept(orgAdmin: Tenant, role: string, label: string): Promise<Tenant> {
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
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
  return { client, userId: data.user.id, email };
}

async function publicUserId(tenant: Tenant): Promise<string> {
  const { data, error } = await tenant.client
    .from("users")
    .select("id")
    .eq("auth_id", tenant.userId)
    .single();
  if (error || !data) throw error ?? new Error("public user row not found");
  return data.id as string;
}

type ContractParams = {
  vendorName: string;
  ownerUserId: string | null;
  costAmount: number;
  currency: string;
  billingCycle: "monthly" | "annual" | "one_time";
  seatsPurchased: number | null;
  renewalDays: number;
  cancellationNoticeDays: number;
  departmentId: string | null;
};

async function createVendorWithContract(admin: Tenant, params: ContractParams) {
  const { data: vendorId, error: vendorError } = await admin.client.rpc("create_vendor", {
    p_catalog_id: null,
    p_name: params.vendorName,
    p_website: "example.test",
    p_category: "other",
    p_owner_user_id: params.ownerUserId,
    p_is_custom: true,
    p_notes: null,
  });
  if (vendorError || !vendorId) throw vendorError ?? new Error("create_vendor failed");

  const { data: contractId, error: contractError } = await admin.client.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: `${params.vendorName} contract`,
    p_cost_amount: params.costAmount,
    p_currency: params.currency,
    p_billing_cycle: params.billingCycle,
    p_seats_purchased: params.seatsPurchased,
    p_start_date: futureDate(-30),
    p_renewal_date: futureDate(params.renewalDays),
    p_auto_renews: true,
    p_cancellation_notice_days: params.cancellationNoticeDays,
    p_document_url: null,
    p_department_id: params.departmentId,
  });
  if (contractError || !contractId) throw contractError ?? new Error("create_contract failed");

  return { vendorId: vendorId as string, contractId: contractId as string };
}

// Bloque 2.3b bloqueó update_contract(p_status='cancelled') — toda
// cancelación pasa por cancel_contract(), que además captura ahorro. Aquí
// solo se siembra un contrato ya cancelado para el dataset del dashboard, así
// que el ahorro es sintético (no es lo que se está probando en este archivo).
async function cancelContract(admin: Tenant, contractId: string) {
  const { error } = await admin.client.rpc("cancel_contract", {
    p_contract_id: contractId,
    p_previous_annual_cost: 100,
    p_new_annual_cost: 0,
    p_savings_amount: 100,
    p_org_currency: "EUR",
    p_closed_at: futureDate(0),
    p_notes: null,
  });
  if (error) throw error;
}

test.describe("Dashboard (bloque 1.5)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("KPIs, pista de renovaciones, gasto por departamento y reconciliación pendiente contra un dataset conocido", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const admin = await signUpOrg("dash-admin");
    const member = await inviteAndAccept(admin, "finance", "dash-member");
    const memberPublicId = await publicUserId(member);
    const adminPublicId = await publicUserId(admin);

    const { data: departmentId, error: deptError } = await admin.client.rpc("create_department", {
      p_name: "Ingeniería",
      p_manager_user_id: null,
    });
    if (deptError || !departmentId) throw deptError ?? new Error("create_department failed");

    // Renovación en 5 días, preaviso de 30 días ya vencido (⚠), depto
    // Ingeniería, 2 asientos comprados / 1 activo -> 600€ desperdiciados.
    const hot: ContractParams = {
      vendorName: "VendorHot",
      ownerUserId: adminPublicId,
      costAmount: 1200,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: 2,
      renewalDays: 5,
      cancellationNoticeDays: 30,
      departmentId,
    };
    const { contractId: hotContractId } = await createVendorWithContract(admin, hot);
    await admin.client.rpc("assign_seat", { p_contract_id: hotContractId, p_user_id: memberPublicId });

    // Renovación en 26 días con 14 de preaviso -> 12 días accionables (ámbar),
    // depto Ingeniería.
    const amber: ContractParams = {
      vendorName: "VendorAmber",
      ownerUserId: adminPublicId,
      costAmount: 600,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 26,
      cancellationNoticeDays: 14,
      departmentId,
    };
    await createVendorWithContract(admin, amber);

    // Renovación en 80 días con 30 de preaviso (neutro también en días
    // accionables: 80-30=50 > 45), sin departamento -> "Sin asignar".
    const neutral: ContractParams = {
      vendorName: "VendorNeutral",
      ownerUserId: adminPublicId,
      costAmount: 300,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 80,
      cancellationNoticeDays: 30,
      departmentId: null,
    };
    await createVendorWithContract(admin, neutral);

    // Vencido hace 3 días, depto Ingeniería, ciclo mensual (100 x 12 = 1200/año).
    const overdue: ContractParams = {
      vendorName: "VendorOverdue",
      ownerUserId: adminPublicId,
      costAmount: 100,
      currency: "EUR",
      billingCycle: "monthly",
      seatsPurchased: null,
      renewalDays: -3,
      cancellationNoticeDays: 30,
      departmentId,
    };
    await createVendorWithContract(admin, overdue);

    // Renovación en 40 días, USD (1000 USD x 0.93 = 930€ con el rate
    // sembrado en 0011_dashboard.sql), sin departamento.
    const usd: ContractParams = {
      vendorName: "VendorUsd",
      ownerUserId: adminPublicId,
      costAmount: 1000,
      currency: "USD",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 40,
      cancellationNoticeDays: 30,
      departmentId: null,
    };
    await createVendorWithContract(admin, usd);

    // Contrato cancelado: debe excluirse de todos los KPIs/pista/departamentos.
    const cancelled: ContractParams = {
      vendorName: "VendorCancelled",
      ownerUserId: adminPublicId,
      costAmount: 99999,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 10,
      cancellationNoticeDays: 30,
      departmentId,
    };
    const { contractId: cancelledContractId } = await createVendorWithContract(admin, cancelled);
    await cancelContract(admin, cancelledContractId);

    // Vendor activo sin owner, sin contrato -> "1 sin owner asignado".
    await admin.client.rpc("create_vendor", {
      p_catalog_id: null,
      p_name: "VendorNoOwner",
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_is_custom: true,
      p_notes: null,
    });

    // Un movimiento pendiente de reconciliar, con sugerencia de alta
    // confianza conocida (ver docs/DECISIONS.md bloque 1.3).
    const { data: batchId, error: batchError } = await admin.client.rpc("create_import_batch", {
      p_original_filename: "dashboard-e2e.csv",
      p_delimiter: ",",
      p_encoding: "utf-8",
      p_has_header: true,
    });
    if (batchError || !batchId) throw batchError ?? new Error("create_import_batch failed");
    const { error: importError } = await admin.client.rpc("import_spend_records", {
      p_batch_id: batchId,
      p_records: [
        {
          date: futureDate(-5),
          amount: 311.88,
          currency: "EUR",
          raw_description: "ADOBE *CREATIVE CLD",
        },
      ],
      p_error_count: 0,
      p_has_header: true,
    });
    if (importError) throw importError;

    // --- Login real por la UI y verificación del dashboard renderizado ---
    await page.goto("/es/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    const annualizedCard = page.getByText("Gasto anualizado", { exact: true }).locator("..");
    await expect(annualizedCard.getByText("4230 €", { exact: true })).toBeVisible();
    await expect(annualizedCard.getByText("5 contratos activos · 2 moneda(s)")).toBeVisible();

    const vendorsCard = page.getByText("Vendors activos", { exact: true }).locator("..");
    await expect(vendorsCard.getByText("7", { exact: true })).toBeVisible();
    await expect(vendorsCard.getByText("1 sin owner asignado")).toBeVisible();

    const wastedCard = page.getByText("Licencias sin uso", { exact: true }).locator("..");
    await expect(wastedCard.getByText("600 €", { exact: true })).toBeVisible();
    await expect(wastedCard.getByText("1 asientos sin actividad")).toBeVisible();

    const renewalsCard = page.getByText("Renovaciones · 90 días", { exact: true }).locator("..");
    await expect(renewalsCard.getByText("4", { exact: true })).toBeVisible();
    await expect(renewalsCard.getByText("2 en los próximos 30 días")).toBeVisible();

    // Mapa de calor de renovaciones: por defecto carga el MES ACTUAL.
    // VendorHot (accionable -25d) y VendorOverdue (accionable -33d) clampan
    // al día de hoy, así que siempre están en el mes actual sin importar qué
    // día del mes sea "hoy" en tiempo de ejecución del test. El panel se
    // identifica por su región (no basta con getByRole("link"): la
    // alternativa sr-only del horizonte completo también contiene enlaces
    // con el mismo nombre de vendor).
    const heatmapPanel = page.getByRole("region", { name: "Detalle de la selección" });
    await expect(heatmapPanel.getByRole("link", { name: /VendorHot/ })).toBeVisible();
    await expect(heatmapPanel.getByRole("link", { name: /VendorHot/ })).toContainText(
      "⚠ 5 días · preaviso 30d",
    );
    await expect(heatmapPanel.getByRole("link", { name: /VendorOverdue/ })).toContainText(
      "Vencido hace 3 días",
    );
    await expect(page.getByRole("link").filter({ hasText: "VendorCancelled" })).toHaveCount(0);

    // Clic en la celda de HOY acota el panel al día exacto, excluyendo
    // VendorAmber (+12d) y VendorUsd (+10d) — confirma que la selección por
    // día es más estrecha que la selección por mes.
    const heatmapGrid = page.getByRole("group", { name: "Días del mapa de calor" });
    const dayCellLabel = (offsetDays: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      // Año incluido a propósito: el aria-label real de la celda lo incluye
      // siempre (el día de hoy y el último día del horizonte de 12 meses
      // comparten día+mes — ver comentario de cellDateFormatter en
      // renewal-heatmap.tsx), así que un match sin año sería ambiguo.
      return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(date);
    };
    await heatmapGrid.getByRole("button", { name: new RegExp(`^${dayCellLabel(0)}:`) }).click();
    await expect(heatmapPanel.getByRole("link", { name: /VendorAmber/ })).toHaveCount(0);
    await expect(heatmapPanel.getByRole("link", { name: /VendorUsd/ })).toHaveCount(0);

    // Clic en la celda exacta de VendorAmber (+12d) muestra solo esa renovación.
    await heatmapGrid.getByRole("button", { name: new RegExp(`^${dayCellLabel(12)}:`) }).click();
    await expect(heatmapPanel.getByRole("link", { name: /VendorAmber/ })).toContainText("12 días");
    await expect(heatmapPanel.getByRole("link", { name: /VendorHot/ })).toHaveCount(0);

    // Gasto por departamento.
    const deptRow = page.getByRole("row", { name: /Ingeniería/ });
    await expect(deptRow.getByText("3000 €", { exact: true })).toBeVisible();
    await expect(deptRow.getByText("3", { exact: true })).toBeVisible();

    const unassignedRow = page.getByRole("row", { name: /General \/ Sin asignar/ });
    await expect(unassignedRow.getByText("1230 €", { exact: true })).toBeVisible();
    await expect(unassignedRow.getByText("2", { exact: true })).toBeVisible();

    // Reconciliación pendiente.
    await expect(page.getByText("ADOBE *CREATIVE CLD")).toBeVisible();
    await expect(page.getByText("¿Adobe Creative Cloud?")).toBeVisible();
    await expect(page.getByText("1 movimientos sin vendor asignado.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Revisar la cola completa →" })).toHaveAttribute(
      "href",
      "/es/reconciliation",
    );
  });

  test("mapa de calor de renovaciones: mes actual por defecto, filtro por mes/día, navegación por teclado, horizonte de 12 meses", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const admin = await signUpOrg("heatmap-admin");
    const adminPublicId = await publicUserId(admin);

    // Renovación hoy mismo (sin preaviso -> actionable == renewalDays == 0):
    // siempre cae en el día de hoy y en el mes actual, sin ambigüedad.
    const todayContract: ContractParams = {
      vendorName: "TodayVendor",
      ownerUserId: adminPublicId,
      costAmount: 100,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 0,
      cancellationNoticeDays: 0,
      departmentId: null,
    };
    const { vendorId: todayVendorId, contractId: todayContractId } = await createVendorWithContract(
      admin,
      todayContract,
    );

    // +50 días (sin preaviso): garantiza un mes distinto al actual sea cual
    // sea el día del mes en que corra el test (>31 días de margen).
    const futureContract: ContractParams = {
      vendorName: "FutureVendor",
      ownerUserId: adminPublicId,
      costAmount: 100,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 50,
      cancellationNoticeDays: 0,
      departmentId: null,
    };
    const { vendorId: futureVendorId, contractId: futureContractId } = await createVendorWithContract(
      admin,
      futureContract,
    );

    // +400 días: fuera del horizonte fijo de 12 meses -> nunca debe
    // aparecer, ni en el grid (celda) ni en ningún panel.
    await createVendorWithContract(admin, {
      vendorName: "BeyondHorizonVendor",
      ownerUserId: adminPublicId,
      costAmount: 100,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 400,
      cancellationNoticeDays: 0,
      departmentId: null,
    });

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    const heatmapPanel = page.getByRole("region", { name: "Detalle de la selección" });
    const heatmapGrid = page.getByRole("group", { name: "Días del mapa de calor" });
    const heatmapMonthRow = page.getByRole("group", { name: "Meses del mapa de calor" });

    const dayLabel = (offsetDays: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      // Año incluido a propósito: el aria-label real de la celda lo incluye
      // siempre (el día de hoy y el último día del horizonte de 12 meses
      // comparten día+mes — ver comentario de cellDateFormatter en
      // renewal-heatmap.tsx), así que un match sin año sería ambiguo.
      return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(date);
    };
    const monthLabel = (offsetDays: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(date);
    };

    // Por defecto: mes actual — incluye TodayVendor, excluye FutureVendor y
    // BeyondHorizonVendor (fuera del horizonte, ni siquiera está en el grid).
    await expect(heatmapPanel.getByRole("link", { name: /TodayVendor/ })).toBeVisible();
    await expect(heatmapPanel.getByRole("link", { name: /FutureVendor/ })).toHaveCount(0);
    await expect(page.getByRole("link").filter({ hasText: "BeyondHorizonVendor" })).toHaveCount(0);

    // Clic en la etiqueta del mes de FutureVendor (+50d) cambia el panel a
    // ese mes completo.
    await heatmapMonthRow.getByRole("button", { name: `Ver renovaciones de ${monthLabel(50)}` }).click();
    await expect(heatmapPanel.getByRole("link", { name: /FutureVendor/ })).toBeVisible();
    await expect(heatmapPanel.getByRole("link", { name: /TodayVendor/ })).toHaveCount(0);

    // Clic en la celda de día exacta de FutureVendor acota aún más, al
    // mismo resultado de un único día.
    await heatmapGrid.getByRole("button", { name: new RegExp(`^${dayLabel(50)}:`) }).click();
    await expect(heatmapPanel.getByRole("link", { name: /FutureVendor/ })).toBeVisible();
    await expect(heatmapPanel.getByRole("link", { name: /FutureVendor/ })).toHaveAttribute(
      "href",
      `/es/vendors/${futureVendorId}#contract-${futureContractId}`,
    );

    // Navegación por teclado: foco + Enter en la celda de HOY produce el
    // mismo efecto que un clic (confirma que son botones nativos).
    await heatmapGrid.getByRole("button", { name: new RegExp(`^${dayLabel(0)}:`) }).focus();
    await page.keyboard.press("Enter");
    await expect(heatmapPanel.getByRole("link", { name: /TodayVendor/ })).toBeVisible();
    await expect(heatmapPanel.getByRole("link", { name: /FutureVendor/ })).toHaveCount(0);
    await expect(heatmapPanel.getByRole("link", { name: /TodayVendor/ })).toHaveAttribute(
      "href",
      `/es/vendors/${todayVendorId}#contract-${todayContractId}`,
    );
  });
});
