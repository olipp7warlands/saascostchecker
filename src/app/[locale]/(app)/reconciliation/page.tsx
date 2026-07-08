import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import type { ReconciliationQueueRow } from "@/features/reconciliation/types";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { ReconciliationTable } from "./reconciliation-table";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Reconciliation");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const [{ data: queue }, { data: vendors }] = await Promise.all([
    supabase
      .from("reconciliation_queue")
      .select(
        "id, confidence, status, spend_records(date, amount, currency, raw_description), saas_catalog(id, name, website)",
      )
      .eq("status", "pending")
      .order("confidence", { ascending: false, nullsFirst: false }),
    supabase.from("vendors").select("id, name").order("name", { ascending: true }),
  ]);

  const rows: ReconciliationQueueRow[] = (queue ?? []).map((item) => {
    const spendRecord = Array.isArray(item.spend_records) ? item.spend_records[0] : item.spend_records;
    const catalogEntry = Array.isArray(item.saas_catalog) ? item.saas_catalog[0] : item.saas_catalog;
    return {
      id: item.id,
      date: spendRecord?.date ?? "",
      amount: Number(spendRecord?.amount ?? 0),
      currency: spendRecord?.currency ?? "EUR",
      rawDescription: spendRecord?.raw_description ?? "",
      suggestedCatalogId: catalogEntry?.id ?? null,
      suggestedName: catalogEntry?.name ?? null,
      suggestedWebsite: catalogEntry?.website ?? null,
      confidence: item.confidence == null ? null : Number(item.confidence),
      status: item.status,
    };
  });

  return (
    <div>
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("title")}
      </h1>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="mt-6">
          <ReconciliationTable rows={rows} vendors={vendors ?? []} locale={locale} />
        </div>
      )}
    </div>
  );
}
