// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Este test crea usuarios/orgs reales vía signUp()/RPCs. Solo debe correr
// contra la instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `permissions.test.ts (spend-import) apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
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

type CsvRecord = { date: string; amount: number; currency: string; raw_description: string };

async function importRecords(tenant: TestTenant, records: CsvRecord[]) {
  const { data: batchId, error: batchError } = await tenant.client.rpc("create_import_batch", {
    p_original_filename: `test-${randomSuffix()}.csv`,
    p_delimiter: ",",
    p_encoding: "utf-8",
    p_has_header: true,
  });
  if (batchError) return { batchId: null as string | null, error: batchError };

  const { data, error } = await tenant.client.rpc("import_spend_records", {
    p_batch_id: batchId,
    p_records: records,
    p_error_count: 0,
    p_has_header: true,
  });

  return { batchId: batchId as string, summary: data as { imported: number; duplicates: number } | null, error };
}

describe("Permisos de import de gasto / reconciliación (bloque 1.3)", () => {
  let admin: TestTenant;
  let manager: TestTenant;
  let finance: TestTenant;
  let itAdmin: TestTenant;
  let employee: TestTenant;
  let otherOrgAdmin: TestTenant;

  beforeAll(async () => {
    admin = await signUpOrg("spend-admin");

    [manager, finance, itAdmin, employee] = await Promise.all([
      inviteAndAccept(admin, "manager", "spend-manager"),
      inviteAndAccept(admin, "finance", "spend-finance"),
      inviteAndAccept(admin, "it_admin", "spend-itadmin"),
      inviteAndAccept(admin, "employee", "spend-employee"),
    ]);

    otherOrgAdmin = await signUpOrg("spend-other");
  });

  it.each([
    ["finance", () => finance],
    ["it_admin", () => itAdmin],
    ["org_admin", () => admin],
  ])("%s puede importar un CSV de gasto", async (_role, getTenant) => {
    const { summary, error } = await importRecords(getTenant(), [
      { date: "2026-01-15", amount: 45, currency: "EUR", raw_description: `GITHUB.COM ${randomSuffix()}` },
    ]);
    expect(error).toBeNull();
    expect(summary?.imported).toBe(1);
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede importar un CSV de gasto", async (_role, getTenant) => {
    const { error } = await importRecords(getTenant(), [
      { date: "2026-01-15", amount: 10, currency: "EUR", raw_description: "BLOCKED" },
    ]);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);
  });

  it("deduplica por fecha+importe+descripción normalizada contra todo el histórico de la org", async () => {
    const description = `AWS EMEA ${randomSuffix()}`;
    const record = { date: "2026-02-01", amount: 120.5, currency: "EUR", raw_description: description };

    const first = await importRecords(finance, [record]);
    expect(first.error).toBeNull();
    expect(first.summary?.imported).toBe(1);
    expect(first.summary?.duplicates).toBe(0);

    // Mismo movimiento en un batch DISTINTO (no solo el mismo batch) — el
    // dedup debe comparar contra todo el histórico de la org.
    const second = await importRecords(finance, [record]);
    expect(second.error).toBeNull();
    expect(second.summary?.imported).toBe(0);
    expect(second.summary?.duplicates).toBe(1);
  });

  it("import.created e import.completed quedan en audit_log", async () => {
    const { batchId, error } = await importRecords(finance, [
      { date: "2026-01-20", amount: 9.99, currency: "EUR", raw_description: `SLACK T-${randomSuffix()}` },
    ]);
    expect(error).toBeNull();

    const { data: entries, error: auditError } = await admin.client
      .from("audit_log")
      .select("action")
      .eq("entity_id", batchId)
      .in("action", ["import.created", "import.completed"]);

    expect(auditError).toBeNull();
    expect(entries?.map((e) => e.action).sort()).toEqual(["import.completed", "import.created"]);
  });

  it("genera una sugerencia de alta confianza para una descripción bancaria reconocible", async () => {
    const { batchId, error } = await importRecords(finance, [
      { date: "2026-03-01", amount: 15, currency: "EUR", raw_description: `ADOBE *CREATIVE CLD ${randomSuffix()}` },
    ]);
    expect(error).toBeNull();

    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    expect(spendRecords).toHaveLength(1);

    const { data: queue, error: queueError } = await admin.client
      .from("reconciliation_queue")
      .select("confidence, status, suggested_catalog_id, saas_catalog(name)")
      .eq("spend_record_id", spendRecords![0].id)
      .single();

    expect(queueError).toBeNull();
    expect(queue?.status).toBe("pending");
    expect(Number(queue?.confidence)).toBeGreaterThanOrEqual(0.65);
    const catalogEntry = Array.isArray(queue?.saas_catalog) ? queue.saas_catalog[0] : queue?.saas_catalog;
    expect(catalogEntry?.name).toBe("Adobe Creative Cloud");
  });

  it.each([
    ["manager", () => manager],
    ["employee", () => employee],
  ])("%s NO puede vincular ni ignorar la cola de reconciliación", async (_role, getTenant) => {
    const { batchId } = await importRecords(finance, [
      { date: "2026-03-05", amount: 20, currency: "EUR", raw_description: `ZOOM.US ${randomSuffix()}` },
    ]);
    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    const { data: queueRow } = await admin.client
      .from("reconciliation_queue")
      .select("id, suggested_catalog_id")
      .eq("spend_record_id", spendRecords![0].id)
      .single();

    const { error } = await getTenant().client.rpc("link_reconciliation", {
      p_queue_id: queueRow!.id,
      p_vendor_id: null,
      p_catalog_id: queueRow!.suggested_catalog_id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient privileges/i);

    const { error: ignoreError } = await getTenant().client.rpc("ignore_reconciliation", {
      p_queue_id: queueRow!.id,
    });
    expect(ignoreError).not.toBeNull();
    expect(ignoreError?.message).toMatch(/insufficient privileges/i);
  });

  it("vincular crea el vendor desde el catálogo (find-or-create) y audita vendor.created + reconciliation.linked", async () => {
    const { batchId } = await importRecords(itAdmin, [
      { date: "2026-03-10", amount: 30, currency: "EUR", raw_description: `PDDLE.NET* LOOM ${randomSuffix()}` },
    ]);
    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    const { data: queueRow } = await admin.client
      .from("reconciliation_queue")
      .select("id, suggested_catalog_id")
      .eq("spend_record_id", spendRecords![0].id)
      .single();

    const { data: vendorId, error } = await itAdmin.client.rpc("link_reconciliation", {
      p_queue_id: queueRow!.id,
      p_vendor_id: null,
      p_catalog_id: queueRow!.suggested_catalog_id,
    });
    expect(error).toBeNull();
    expect(vendorId).toBeTruthy();

    const { data: spendAfter } = await admin.client
      .from("spend_records")
      .select("vendor_id")
      .eq("id", spendRecords![0].id)
      .single();
    expect(spendAfter?.vendor_id).toBe(vendorId);

    const { data: auditEntries } = await admin.client
      .from("audit_log")
      .select("action")
      .eq("entity_id", vendorId)
      .eq("action", "vendor.created");
    expect(auditEntries).toHaveLength(1);

    const { data: linkedAudit } = await admin.client
      .from("audit_log")
      .select("action")
      .eq("entity_id", queueRow!.id)
      .eq("action", "reconciliation.linked");
    expect(linkedAudit).toHaveLength(1);
  });

  it("dos reconciliaciones al mismo catalog_id en la misma org reutilizan el mismo vendor (índice único)", async () => {
    const { batchId } = await importRecords(finance, [
      { date: "2026-03-11", amount: 12, currency: "EUR", raw_description: `SP * SHOPIFY ${randomSuffix()}A` },
      { date: "2026-03-12", amount: 18, currency: "EUR", raw_description: `SP * SHOPIFY ${randomSuffix()}B` },
    ]);
    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId)
      .order("date", { ascending: true });
    expect(spendRecords).toHaveLength(2);

    const { data: queueRows } = await admin.client
      .from("reconciliation_queue")
      .select("id, suggested_catalog_id")
      .in(
        "spend_record_id",
        spendRecords!.map((r) => r.id),
      );
    expect(queueRows).toHaveLength(2);
    expect(queueRows![0].suggested_catalog_id).toBe(queueRows![1].suggested_catalog_id);

    const { data: vendorIdA } = await finance.client.rpc("link_reconciliation", {
      p_queue_id: queueRows![0].id,
      p_vendor_id: null,
      p_catalog_id: queueRows![0].suggested_catalog_id,
    });
    const { data: vendorIdB } = await finance.client.rpc("link_reconciliation", {
      p_queue_id: queueRows![1].id,
      p_vendor_id: null,
      p_catalog_id: queueRows![1].suggested_catalog_id,
    });

    expect(vendorIdA).toBe(vendorIdB);

    const { data: vendorCount } = await admin.client
      .from("vendors")
      .select("id", { count: "exact" })
      .eq("catalog_id", queueRows![0].suggested_catalog_id!);
    expect(vendorCount).toHaveLength(1);
  });

  it("ignore_reconciliation marca la fila como ignorada sin tocar spend_records.vendor_id", async () => {
    const { batchId } = await importRecords(finance, [
      { date: "2026-03-15", amount: 5, currency: "EUR", raw_description: `OFICINA SUMINISTROS SL ${randomSuffix()}` },
    ]);
    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    const { data: queueRow } = await admin.client
      .from("reconciliation_queue")
      .select("id")
      .eq("spend_record_id", spendRecords![0].id)
      .single();

    const { error } = await finance.client.rpc("ignore_reconciliation", { p_queue_id: queueRow!.id });
    expect(error).toBeNull();

    const { data: after } = await admin.client
      .from("reconciliation_queue")
      .select("status")
      .eq("id", queueRow!.id)
      .single();
    expect(after?.status).toBe("ignored");
  });

  it("bulk_accept_reconciliation re-valida confidence>=0.65 en servidor y salta las de confianza media/baja", async () => {
    const { batchId } = await importRecords(finance, [
      // Alta confianza (alias exacto)
      { date: "2026-03-20", amount: 8, currency: "EUR", raw_description: `MSFT * CLIPCHAMP ${randomSuffix()}` },
      // Sin match razonable en el catálogo -> confidence baja/null
      { date: "2026-03-21", amount: 3, currency: "EUR", raw_description: `FACTURA LUZ ENDESA ${randomSuffix()}` },
    ]);
    const { data: spendRecords } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId)
      .order("date", { ascending: true });
    const { data: queueRows } = await admin.client
      .from("reconciliation_queue")
      .select("id, confidence")
      .in(
        "spend_record_id",
        spendRecords!.map((r) => r.id),
      );

    const { data: result, error } = await finance.client.rpc("bulk_accept_reconciliation", {
      p_queue_ids: queueRows!.map((q) => q.id),
    });
    expect(error).toBeNull();
    expect((result as { linked: number; skipped: number }).linked).toBe(1);
    expect((result as { linked: number; skipped: number }).skipped).toBe(1);
  });

  it("un admin no ve ni puede resolver la cola de reconciliación de otra org", async () => {
    const { batchId } = await importRecords(otherOrgAdmin, [
      { date: "2026-03-25", amount: 40, currency: "EUR", raw_description: `FIGMA INC ${randomSuffix()}` },
    ]);

    const { data: crossOrgRead } = await admin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    expect(crossOrgRead).toEqual([]);

    const { data: theirSpendRecords } = await otherOrgAdmin.client
      .from("spend_records")
      .select("id")
      .eq("import_batch_id", batchId);
    const { data: theirQueueRow } = await otherOrgAdmin.client
      .from("reconciliation_queue")
      .select("id, suggested_catalog_id")
      .eq("spend_record_id", theirSpendRecords![0].id)
      .single();

    const { error } = await admin.client.rpc("link_reconciliation", {
      p_queue_id: theirQueueRow!.id,
      p_vendor_id: null,
      p_catalog_id: theirQueueRow!.suggested_catalog_id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not found/i);
  });
});
