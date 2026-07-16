import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { VendorRow, type VendorRowData } from "./vendor-row";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function VendorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Vendors");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const [{ data: vendors }, { data: members }] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, website, category, status, is_custom, owner_user_id, contracts(id, cost_amount, currency, billing_cycle, seats_purchased, renewal_date, status, start_date, seat_assignments(id, last_seen_active_at))",
      )
      .order("name", { ascending: true }),
    supabase.from("users").select("id, full_name, email").order("full_name", { ascending: true }),
  ]);

  const membersById = new Map((members ?? []).map((member) => [member.id, member]));

  const rows: VendorRowData[] = (vendors ?? []).map((vendor) => {
    const activeContracts = (vendor.contracts ?? [])
      .filter((contract) => contract.status === "active")
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
    const contract = activeContracts[0] ?? null;
    const owner = vendor.owner_user_id ? (membersById.get(vendor.owner_user_id) ?? null) : null;

    return {
      id: vendor.id,
      name: vendor.name,
      website: vendor.website,
      category: vendor.category,
      status: vendor.status,
      isCustom: vendor.is_custom,
      ownerName: owner?.full_name ?? owner?.email ?? null,
      contract: contract
        ? {
            costAmount: Number(contract.cost_amount),
            currency: contract.currency,
            billingCycle: contract.billing_cycle,
            seatsPurchased: contract.seats_purchased,
            renewalDate: contract.renewal_date,
            activeSeats: (contract.seat_assignments ?? []).filter(
              (seat) => seat.last_seen_active_at !== null,
            ).length,
          }
        : null,
    };
  });

  return (
    <div>
      <Breadcrumbs items={[{ label: t("crumb") }]} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
          {t("title")}
        </h1>
        <a
          href={`/${locale}/vendors/new`}
          className="inline-flex h-9 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#2A2E30]"
        >
          {t("addButton")}
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.vendor")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.status")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.annualCost")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.seats")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.utilization")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.renewal")}
                  </th>
                  <th className="border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    {t("table.owner")}
                  </th>
                  <th className="border-b border-line px-2 py-2.5 text-right text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                    <span className="sr-only">{t("detail.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <VendorRow key={row.id} vendor={row} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
