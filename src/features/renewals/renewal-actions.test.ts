// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Mismo guard que renewal-alerts.test.ts: crea org/usuarios reales y siembra
// contratos vía service_role, solo debe correr contra Supabase local.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `renewal-actions.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
  );
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function newAnonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const admin: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type TestTenant = { client: SupabaseClient; userId: string; email: string };

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
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
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
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
  return { client, userId: data.user.id, email };
}

async function internalUserId(caller: TestTenant, email: string): Promise<string> {
  const { data, error } = await caller.client.from("users").select("id").eq("email", email).single();
  if (error || !data) throw error ?? new Error(`no internal user row for ${email}`);
  return data.id;
}

// Fecha simulada fija — el motor y las RPCs nunca leen current_date en estos
// tests, así el resultado no depende de cuándo corra la suite.
const TODAY = "2026-09-01";
const TODAY_PLUS_30 = "2026-10-01";

function dateFrom(base: string, daysFromBase: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysFromBase);
  return d.toISOString().slice(0, 10);
}

describe("Acciones sobre renovaciones (bloque 2.3b)", () => {
  let orgAdmin: TestTenant;
  let employee: TestTenant;
  let orgId: string;
  let vendorId: string;

  beforeAll(async () => {
    orgAdmin = await signUpOrg("actions");
    employee = await inviteAndAccept(orgAdmin, "employee", "actions-emp");

    const adminId = await internalUserId(orgAdmin, orgAdmin.email);
    const { data: ownerRow, error: ownerErr } = await admin
      .from("users")
      .select("org_id")
      .eq("id", adminId)
      .single();
    if (ownerErr || !ownerRow) throw ownerErr ?? new Error("owner row not found");
    orgId = ownerRow.org_id;

    const { data: vendor, error: vendorErr } = await admin
      .from("vendors")
      .insert({
        org_id: orgId,
        name: "Actions Vendor",
        website: "actions-vendor.test",
        category: "other",
        status: "active",
        is_custom: true,
        owner_user_id: adminId,
      })
      .select("id")
      .single();
    if (vendorErr || !vendor) throw vendorErr ?? new Error("vendor insert failed");
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await admin.from("savings_records").delete().eq("org_id", orgId);
    await admin.from("notifications").delete().eq("org_id", orgId);
    await admin.from("contracts").delete().eq("org_id", orgId);
    await admin.from("vendors").delete().eq("org_id", orgId);
  });

  async function insertContract(overrides: Record<string, unknown>) {
    const { data, error } = await admin
      .from("contracts")
      .insert({
        org_id: orgId,
        vendor_id: vendorId,
        name: `Contract ${randomSuffix()}`,
        cost_amount: 1200,
        currency: "EUR",
        billing_cycle: "annual",
        seats_purchased: null,
        start_date: "2025-01-01",
        renewal_date: dateFrom(TODAY, 30),
        auto_renews: false,
        cancellation_notice_days: 30,
        status: "active",
        ...overrides,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("contract insert failed");
    return data.id as string;
  }

  it("contrato con snoozed_until cubriendo el umbral -> 0 alertas para ese umbral", async () => {
    const contractId = await insertContract({
      renewal_date: dateFrom(TODAY, 30),
      snoozed_until: dateFrom(TODAY, 10),
    });

    await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });

    const { data: rows } = await admin.from("notifications").select("id").eq("contract_id", contractId);
    expect(rows).toHaveLength(0);
  });

  it("snoozed_until ya vencido -> el umbral se alerta con normalidad", async () => {
    const contractId = await insertContract({
      renewal_date: dateFrom(TODAY, 30),
      snoozed_until: dateFrom(TODAY, -5),
    });

    await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });

    const { data: rows } = await admin.from("notifications").select("id").eq("contract_id", contractId);
    expect(rows!.length).toBeGreaterThan(0);
  });

  it("regresión: update_contract limpia notifications al cambiar renewal_date, permitiendo regenerar el umbral en la fecha nueva", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30) });

    const { data: firstRun } = await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });
    expect(firstRun).toBeGreaterThan(0);
    const { data: beforeRows } = await admin
      .from("notifications")
      .select("id, threshold_days")
      .eq("contract_id", contractId);
    expect(beforeRows!.some((r) => r.threshold_days === 30)).toBe(true);

    // Renueva la fecha 30 días más allá de TODAY_PLUS_30 -> el mismo umbral
    // (30 días) volverá a ser aplicable, pero en otro p_today.
    const { error: updateError } = await orgAdmin.client.rpc("update_contract", {
      p_contract_id: contractId,
      p_name: "Renewed",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: null,
      p_start_date: "2025-01-01",
      p_renewal_date: dateFrom(TODAY_PLUS_30, 30),
      p_auto_renews: false,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_status: "active",
    });
    expect(updateError).toBeNull();

    const { data: afterUpdateRows } = await admin
      .from("notifications")
      .select("id")
      .eq("contract_id", contractId);
    expect(afterUpdateRows).toHaveLength(0); // limpiado por el fix

    const { data: secondRun } = await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY_PLUS_30 });
    expect(secondRun).toBeGreaterThan(0);
    const { data: afterRows } = await admin
      .from("notifications")
      .select("id, threshold_days")
      .eq("contract_id", contractId);
    expect(afterRows!.some((r) => r.threshold_days === 30)).toBe(true);
  });

  it("update_contract rechaza p_status='cancelled' directamente", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30) });

    const { error } = await orgAdmin.client.rpc("update_contract", {
      p_contract_id: contractId,
      p_name: "Try cancel",
      p_cost_amount: 1200,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: null,
      p_start_date: "2025-01-01",
      p_renewal_date: dateFrom(TODAY, 30),
      p_auto_renews: false,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_status: "cancelled",
    });
    expect(error).not.toBeNull();
  });

  it("renegotiate_contract actualiza el contrato, limpia notifications viejas y crea el savings_record", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30), cost_amount: 1200 });
    await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });
    const { data: beforeRows } = await admin
      .from("notifications")
      .select("id")
      .eq("contract_id", contractId);
    expect(beforeRows!.length).toBeGreaterThan(0);

    const newRenewalDate = dateFrom(TODAY_PLUS_30, 30);
    const { data: savingsId, error } = await orgAdmin.client.rpc("renegotiate_contract", {
      p_contract_id: contractId,
      p_new_cost_amount: 900,
      p_new_currency: "EUR",
      p_new_billing_cycle: "annual",
      p_new_renewal_date: newRenewalDate,
      p_previous_annual_cost: 1200,
      p_new_annual_cost: 900,
      p_savings_amount: 300,
      p_org_currency: "EUR",
      p_closed_at: TODAY,
      p_notes: "Test renegotiation",
    });
    expect(error).toBeNull();
    expect(savingsId).not.toBeNull();

    const { data: contract } = await admin
      .from("contracts")
      .select("cost_amount, renewal_date, status")
      .eq("id", contractId)
      .single();
    expect(Number(contract!.cost_amount)).toBe(900);
    expect(contract!.renewal_date).toBe(newRenewalDate);
    expect(contract!.status).toBe("active");

    const { data: afterRows } = await admin.from("notifications").select("id").eq("contract_id", contractId);
    expect(afterRows).toHaveLength(0);

    const { data: savingsRow } = await admin
      .from("savings_records")
      .select("kind, previous_annual_cost, new_annual_cost, savings_amount, vendor_id")
      .eq("id", savingsId)
      .single();
    // PostgREST devuelve columnas numeric como JSON number, no como string
    // (mismo criterio que Number(contract!.cost_amount) más arriba) — comparar
    // literales de texto ("1200.00") fallaba siempre, no era un bug de cálculo.
    expect(savingsRow!.kind).toBe("renegotiated");
    expect(savingsRow!.vendor_id).toBe(vendorId);
    expect(Number(savingsRow!.previous_annual_cost)).toBe(1200);
    expect(Number(savingsRow!.new_annual_cost)).toBe(900);
    expect(Number(savingsRow!.savings_amount)).toBe(300);
  });

  it("cancel_contract cancela el contrato, limpia notifications pendientes y crea el savings_record", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30), cost_amount: 800 });
    await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });
    const { data: beforeRows } = await admin
      .from("notifications")
      .select("id")
      .eq("contract_id", contractId);
    expect(beforeRows!.length).toBeGreaterThan(0);

    const { data: savingsId, error } = await orgAdmin.client.rpc("cancel_contract", {
      p_contract_id: contractId,
      p_previous_annual_cost: 800,
      p_new_annual_cost: 0,
      p_savings_amount: 800,
      p_org_currency: "EUR",
      p_closed_at: TODAY,
      p_notes: null,
    });
    expect(error).toBeNull();

    const { data: contract } = await admin.from("contracts").select("status").eq("id", contractId).single();
    expect(contract!.status).toBe("cancelled");

    const { data: afterRows } = await admin.from("notifications").select("id").eq("contract_id", contractId);
    expect(afterRows).toHaveLength(0);

    const { data: savingsRow } = await admin
      .from("savings_records")
      .select("kind, savings_amount")
      .eq("id", savingsId)
      .single();
    expect(savingsRow!.kind).toBe("cancelled");
    expect(Number(savingsRow!.savings_amount)).toBe(800);
  });

  it("set_contract_snooze pospone y luego quita el snooze", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30) });

    const { error: snoozeError } = await orgAdmin.client.rpc("set_contract_snooze", {
      p_contract_id: contractId,
      p_snoozed_until: dateFrom(TODAY, 15),
    });
    expect(snoozeError).toBeNull();

    const { data: snoozed } = await admin
      .from("contracts")
      .select("snoozed_until")
      .eq("id", contractId)
      .single();
    expect(snoozed!.snoozed_until).toBe(dateFrom(TODAY, 15));

    const { error: unsnoozeError } = await orgAdmin.client.rpc("set_contract_snooze", {
      p_contract_id: contractId,
      p_snoozed_until: null,
    });
    expect(unsnoozeError).toBeNull();

    const { data: unsnoozed } = await admin
      .from("contracts")
      .select("snoozed_until")
      .eq("id", contractId)
      .single();
    expect(unsnoozed!.snoozed_until).toBeNull();
  });

  it("un rol employee no puede invocar los 3 RPCs nuevos directamente", async () => {
    const contractId = await insertContract({ renewal_date: dateFrom(TODAY, 30) });

    const { error: e1 } = await employee.client.rpc("set_contract_snooze", {
      p_contract_id: contractId,
      p_snoozed_until: dateFrom(TODAY, 7),
    });
    expect(e1).not.toBeNull();

    const { error: e2 } = await employee.client.rpc("renegotiate_contract", {
      p_contract_id: contractId,
      p_new_cost_amount: 100,
      p_new_currency: "EUR",
      p_new_billing_cycle: "annual",
      p_new_renewal_date: dateFrom(TODAY, 400),
      p_previous_annual_cost: 1200,
      p_new_annual_cost: 100,
      p_savings_amount: 1100,
      p_org_currency: "EUR",
      p_closed_at: TODAY,
      p_notes: null,
    });
    expect(e2).not.toBeNull();

    const { error: e3 } = await employee.client.rpc("cancel_contract", {
      p_contract_id: contractId,
      p_previous_annual_cost: 1200,
      p_new_annual_cost: 0,
      p_savings_amount: 1200,
      p_org_currency: "EUR",
      p_closed_at: TODAY,
      p_notes: null,
    });
    expect(e3).not.toBeNull();
  });
});
