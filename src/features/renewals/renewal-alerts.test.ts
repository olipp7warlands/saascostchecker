// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Este test crea org/usuarios reales vía signUp()/RPCs y siembra vendors/
// contracts vía service_role — solo debe correr contra la instancia LOCAL de
// Supabase, nunca contra el proyecto remoto (mismo guard que rls-isolation.test.ts).
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `renewal-alerts.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
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

// Mismo patrón que permissions.test.ts / rls-isolation.test.ts: signUp() real
// ejercita el trigger handle_new_user(), create_invitation()+signUp() da un
// segundo usuario real en la MISMA org con el rol pedido.
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

async function internalUserId(caller: TestTenant, email: string): Promise<string> {
  const { data, error } = await caller.client.from("users").select("id").eq("email", email).single();
  if (error || !data) {
    throw error ?? new Error(`no internal user row for ${email}`);
  }
  return data.id;
}

// Fecha simulada fija que se le pasa como p_today — el motor nunca lee
// current_date en los tests, así el resultado no depende de cuándo se corra.
const TODAY = "2026-09-01";

function isoDate(daysFromToday: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

describe("evaluate_renewal_alerts (bloque 2.1)", () => {
  let orgAdmin: TestTenant;
  let finance: TestTenant;
  let ownerUserId: string;
  let financeUserId: string;
  let orgId: string;
  let vendorId: string;
  const contractIds: Record<string, string> = {};

  const FIRING_KEYS = ["d90", "d60", "d30", "d7", "noticeExpired"] as const;
  const SILENT_KEYS = ["d91", "d89", "d6"] as const;

  beforeAll(async () => {
    orgAdmin = await signUpOrg("renewal");
    finance = await inviteAndAccept(orgAdmin, "finance", "renewal-fin");

    ownerUserId = await internalUserId(orgAdmin, orgAdmin.email);
    financeUserId = await internalUserId(orgAdmin, finance.email);

    const { data: ownerRow, error: ownerErr } = await admin
      .from("users")
      .select("org_id")
      .eq("id", ownerUserId)
      .single();
    if (ownerErr || !ownerRow) throw ownerErr ?? new Error("owner row not found");
    orgId = ownerRow.org_id;

    const { data: vendor, error: vendorErr } = await admin
      .from("vendors")
      .insert({
        org_id: orgId,
        name: "Renewal Vendor",
        website: "renewal-vendor.test",
        category: "other",
        status: "active",
        is_custom: true,
        owner_user_id: ownerUserId,
      })
      .select("id")
      .single();
    if (vendorErr || !vendor) throw vendorErr ?? new Error("vendor insert failed");
    vendorId = vendor.id;

    // 91/89/6 no deben disparar nada; 90/60/30/7 sí; noticeExpired aísla el
    // aviso de preaviso (días crudos hasta renovación = 40, no coincide con
    // ningún umbral) para no confundirse con una alerta de umbral normal.
    const specs: Array<{
      key: string;
      daysUntil: number;
      autoRenews?: boolean;
      noticeDays?: number;
    }> = [
      { key: "d91", daysUntil: 91 },
      { key: "d90", daysUntil: 90 },
      { key: "d89", daysUntil: 89 },
      { key: "d60", daysUntil: 60 },
      { key: "d30", daysUntil: 30 },
      { key: "d7", daysUntil: 7 },
      { key: "d6", daysUntil: 6 },
      { key: "noticeExpired", daysUntil: 40, autoRenews: true, noticeDays: 40 },
    ];

    for (const spec of specs) {
      const { data, error } = await admin
        .from("contracts")
        .insert({
          org_id: orgId,
          vendor_id: vendorId,
          name: `Contract ${spec.key}`,
          cost_amount: 1000,
          currency: "EUR",
          billing_cycle: "annual",
          seats_purchased: 1,
          start_date: "2025-01-01",
          renewal_date: isoDate(spec.daysUntil),
          auto_renews: spec.autoRenews ?? false,
          cancellation_notice_days: spec.noticeDays ?? 30,
          status: "active",
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error(`contract insert failed for ${spec.key}`);
      contractIds[spec.key] = data.id;
    }
  });

  afterAll(async () => {
    await admin.from("notifications").delete().eq("org_id", orgId);
    await admin.from("contracts").delete().eq("org_id", orgId);
    await admin.from("vendors").delete().eq("org_id", orgId);
  });

  it("genera exactamente las alertas 90/60/30/7 + preaviso vencido, ninguna más", async () => {
    const { data: inserted, error } = await admin.rpc("evaluate_renewal_alerts", {
      p_today: TODAY,
    });
    expect(error).toBeNull();
    // 5 contratos disparan x 2 destinatarios (owner + finance) cada uno.
    expect(inserted).toBe(FIRING_KEYS.length * 2);

    const { data: rows, error: selectError } = await admin
      .from("notifications")
      .select("contract_id, user_id, threshold_days, payload")
      .eq("org_id", orgId);
    expect(selectError).toBeNull();

    const firedContractIds = new Set(rows!.map((r) => r.contract_id));
    expect(firedContractIds).toEqual(new Set(FIRING_KEYS.map((k) => contractIds[k])));

    for (const key of SILENT_KEYS) {
      expect(rows!.some((r) => r.contract_id === contractIds[key])).toBe(false);
    }

    for (const key of FIRING_KEYS) {
      const forContract = rows!.filter((r) => r.contract_id === contractIds[key]);
      expect(forContract.map((r) => r.user_id).sort()).toEqual(
        [financeUserId, ownerUserId].sort(),
      );
    }

    const noticeRow = rows!.find(
      (r) => r.contract_id === contractIds.noticeExpired && r.user_id === ownerUserId,
    );
    expect(noticeRow!.threshold_days).toBe(-1);
    expect(noticeRow!.payload.notice_expired).toBe(true);

    const d90Row = rows!.find(
      (r) => r.contract_id === contractIds.d90 && r.user_id === ownerUserId,
    );
    expect(d90Row!.threshold_days).toBe(90);
    expect(d90Row!.payload.days_until).toBe(90);
  });

  it("es idempotente: ejecutarlo dos veces el mismo día no duplica nada", async () => {
    const { count: before } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    const { data: insertedSecondRun, error } = await admin.rpc("evaluate_renewal_alerts", {
      p_today: TODAY,
    });
    expect(error).toBeNull();
    expect(insertedSecondRun).toBe(0);

    const { count: after } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    expect(after).toBe(before);
  });

  it("sin owner asignado, solo finance recibe la alerta", async () => {
    const { data: vendorNoOwner, error: vendorErr } = await admin
      .from("vendors")
      .insert({
        org_id: orgId,
        name: "No Owner Vendor",
        website: "no-owner-vendor.test",
        category: "other",
        status: "active",
        is_custom: true,
      })
      .select("id")
      .single();
    if (vendorErr || !vendorNoOwner) throw vendorErr ?? new Error("vendor insert failed");

    const { data: contract, error: contractErr } = await admin
      .from("contracts")
      .insert({
        org_id: orgId,
        vendor_id: vendorNoOwner.id,
        name: "No owner contract",
        cost_amount: 500,
        currency: "EUR",
        billing_cycle: "annual",
        seats_purchased: 1,
        start_date: "2025-01-01",
        renewal_date: isoDate(30),
        auto_renews: false,
        cancellation_notice_days: 30,
        status: "active",
      })
      .select("id")
      .single();
    if (contractErr || !contract) throw contractErr ?? new Error("contract insert failed");

    const { error } = await admin.rpc("evaluate_renewal_alerts", { p_today: TODAY });
    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("notifications")
      .select("user_id")
      .eq("contract_id", contract.id);

    expect(rows!.map((r) => r.user_id)).toEqual([financeUserId]);

    await admin.from("contracts").delete().eq("id", contract.id);
    await admin.from("vendors").delete().eq("id", vendorNoOwner.id);
  });

  it("un cliente authenticated no puede invocar evaluate_renewal_alerts directamente", async () => {
    const { error } = await orgAdmin.client.rpc("evaluate_renewal_alerts", { p_today: TODAY });
    expect(error).not.toBeNull();
  });

  it("un usuario solo ve sus propias notificaciones (RLS)", async () => {
    const { data: ownRows, error } = await orgAdmin.client
      .from("notifications")
      .select("id, user_id");
    expect(error).toBeNull();
    expect(ownRows!.every((r) => r.user_id === ownerUserId)).toBe(true);
    expect(ownRows!.length).toBeGreaterThan(0);
  });

  it("mark_notification_read marca una notificación propia como leída", async () => {
    const { data: unreadRows } = await orgAdmin.client
      .from("notifications")
      .select("id, read_at")
      .is("read_at", null)
      .limit(1);
    const targetId = unreadRows![0].id;

    const { error } = await orgAdmin.client.rpc("mark_notification_read", {
      p_notification_id: targetId,
    });
    expect(error).toBeNull();

    const { data: after } = await admin.from("notifications").select("read_at").eq("id", targetId).single();
    expect(after!.read_at).not.toBeNull();
  });
});
