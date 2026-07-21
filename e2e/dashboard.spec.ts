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

    // Renovación en 26 días (ámbar), depto Ingeniería.
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

    // Renovación en 70 días (neutro), sin departamento -> "Sin asignar".
    const neutral: ContractParams = {
      vendorName: "VendorNeutral",
      ownerUserId: adminPublicId,
      costAmount: 300,
      currency: "EUR",
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDays: 70,
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

    // Pista de renovaciones: contratos activos visibles, cancelado ausente.
    await expect(page.getByRole("link").filter({ hasText: "VendorHot" })).toBeVisible();
    await expect(page.getByRole("link").filter({ hasText: "VendorHot" })).toContainText(
      "⚠ 5 días · preaviso 30d",
    );
    await expect(page.getByRole("link").filter({ hasText: "VendorOverdue" })).toContainText(
      "Vencido hace 3 días",
    );
    await expect(page.getByRole("link").filter({ hasText: "VendorAmber" })).toContainText("26 días");
    await expect(page.getByRole("link").filter({ hasText: "VendorCancelled" })).toHaveCount(0);

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
});
