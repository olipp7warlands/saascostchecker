import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { getCurrentUserProfile } from "@/features/auth/session";
import type { ExchangeRate } from "@/features/dashboard/types";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import type { SeatRow } from "./contract-seats";
import { VendorFicha } from "./vendor-ficha";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
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
  const [
    { data: vendor },
    { data: contracts },
    { data: members },
    { data: departments },
    { data: companies },
    { data: org },
    { data: rateRows },
    { data: savingsRows },
  ] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).single(),
    supabase
      .from("contracts")
      .select("*")
      .eq("vendor_id", id)
      .order("start_date", { ascending: false }),
    supabase.from("users").select("id, full_name, email").order("full_name", { ascending: true }),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
    supabase.from("organizations").select("default_currency").eq("id", profile.orgId).single(),
    supabase.from("exchange_rates").select("base_currency, quote_currency, rate"),
    supabase.from("savings_records").select("savings_amount").eq("vendor_id", id),
  ]);

  const canManageOrgDimensions = profile.role === "org_admin";
  const orgCurrency = org?.default_currency ?? "EUR";
  const rates: ExchangeRate[] = (rateRows ?? []).map((row) => ({
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
  }));
  const vendorSavingsTotal = (savingsRows ?? []).reduce(
    (sum, row) => sum + Number(row.savings_amount),
    0,
  );

  if (!vendor) {
    notFound();
  }

  const contractIds = (contracts ?? []).map((contract) => contract.id);
  const { data: seatRows } =
    contractIds.length > 0
      ? await supabase
          .from("seat_assignments")
          .select("id, contract_id, user_id, last_seen_active_at")
          .in("contract_id", contractIds)
      : { data: [] as never[] };

  const membersById = new Map((members ?? []).map((member) => [member.id, member]));

  const seatsByContract: Record<string, SeatRow[]> = {};
  for (const row of seatRows ?? []) {
    const member = membersById.get(row.user_id);
    const list = seatsByContract[row.contract_id] ?? [];
    list.push({
      id: row.id,
      userId: row.user_id,
      userName: member?.full_name ?? member?.email ?? row.user_id,
      active: row.last_seen_active_at !== null,
    });
    seatsByContract[row.contract_id] = list;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumbs items={[{ label: t("crumb"), href: `/${locale}/vendors` }, { label: vendor.name }]} />

      <div className="mt-4">
        <VendorFicha
          locale={locale}
          vendor={vendor}
          contracts={contracts ?? []}
          members={members ?? []}
          departments={departments ?? []}
          companies={companies ?? []}
          seatsByContract={seatsByContract}
          canManageOrgDimensions={canManageOrgDimensions}
          orgCurrency={orgCurrency}
          rates={rates}
          vendorSavingsTotal={vendorSavingsTotal}
        />
      </div>
    </div>
  );
}
