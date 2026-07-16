import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import {
  buildCompanySpend,
  buildDepartmentSpend,
  buildKpis,
  buildRenewalTrack,
  buildStackStatus,
} from "@/features/dashboard/aggregate";
import { buildMonthlySpendSeries } from "@/features/dashboard/monthly-spend";
import type {
  DashboardContract,
  DashboardVendor,
  ExchangeRate,
  MonthlySpendRow,
  ReconciliationPreviewRow,
  SpendGroupRow,
} from "@/features/dashboard/types";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { KpiCards } from "./kpi-cards";
import { MonthlySpendChart } from "./monthly-spend-chart";
import { ReconciliationPreview } from "./reconciliation-preview";
import { RenewalTrack } from "./renewal-track";
import { SpendByGroupChart } from "./spend-by-group-chart";
import { StackStatusDonut } from "./stack-status-donut";

const MONTHLY_SPEND_WINDOW = 12;

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];
const RECONCILIATION_PREVIEW_LIMIT = 3;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Shell.dashboard");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const [
    { data: vendorRows },
    { data: rateRows },
    { data: queueRows, count: pendingCount },
    { data: org },
    { data: monthlySpendRows },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, website, status, owner_user_id, contracts(id, cost_amount, currency, billing_cycle, seats_purchased, renewal_date, auto_renews, cancellation_notice_days, status, department_id, departments(name), company_id, companies(name), seat_assignments(id, last_seen_active_at))",
      ),
    supabase.from("exchange_rates").select("base_currency, quote_currency, rate"),
    supabase
      .from("reconciliation_queue")
      .select(
        "id, confidence, spend_records(date, amount, currency, raw_description), saas_catalog(name)",
        { count: "exact" },
      )
      .eq("status", "pending")
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(RECONCILIATION_PREVIEW_LIMIT),
    supabase.from("organizations").select("default_currency").eq("id", profile.orgId).single(),
    supabase.rpc("dashboard_monthly_spend", { p_months: MONTHLY_SPEND_WINDOW }),
  ]);

  const orgCurrency = org?.default_currency ?? "EUR";
  const rates: ExchangeRate[] = (rateRows ?? []).map((row) => ({
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
  }));

  const vendors: DashboardVendor[] = (vendorRows ?? []).map((vendor) => ({
    id: vendor.id,
    status: vendor.status,
    ownerUserId: vendor.owner_user_id,
  }));

  const contracts: DashboardContract[] = (vendorRows ?? []).flatMap((vendor) =>
    (vendor.contracts ?? []).map((contract) => {
      const department = Array.isArray(contract.departments)
        ? contract.departments[0]
        : contract.departments;
      const company = Array.isArray(contract.companies) ? contract.companies[0] : contract.companies;
      return {
        id: contract.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorWebsite: vendor.website,
        costAmount: Number(contract.cost_amount),
        currency: contract.currency,
        billingCycle: contract.billing_cycle,
        seatsPurchased: contract.seats_purchased,
        activeSeats: (contract.seat_assignments ?? []).filter(
          (seat) => seat.last_seen_active_at !== null,
        ).length,
        renewalDate: contract.renewal_date,
        autoRenews: contract.auto_renews,
        cancellationNoticeDays: contract.cancellation_notice_days,
        status: contract.status,
        departmentId: contract.department_id,
        departmentName: department?.name ?? null,
        companyId: contract.company_id,
        companyName: company?.name ?? null,
      };
    }),
  );

  const queue: ReconciliationPreviewRow[] = (queueRows ?? []).map((item) => {
    const spendRecord = Array.isArray(item.spend_records) ? item.spend_records[0] : item.spend_records;
    const catalogEntry = Array.isArray(item.saas_catalog) ? item.saas_catalog[0] : item.saas_catalog;
    return {
      id: item.id,
      date: spendRecord?.date ?? "",
      amount: Number(spendRecord?.amount ?? 0),
      currency: spendRecord?.currency ?? orgCurrency,
      rawDescription: spendRecord?.raw_description ?? "",
      suggestedName: catalogEntry?.name ?? null,
    };
  });

  const kpis = buildKpis(contracts, vendors, orgCurrency, rates);
  const tickets = buildRenewalTrack(contracts);
  const stackStatus = buildStackStatus(vendors, contracts);

  const departmentRows = buildDepartmentSpend(
    contracts,
    orgCurrency,
    rates,
    t("departmentSpend.unassigned"),
  );
  const companyRows = buildCompanySpend(contracts, orgCurrency, rates, t("companySpend.unassigned"));
  // El chart de barras es agnóstico a departamento/empresa — normaliza ambas
  // filas al mismo shape (SpendGroupRow) en vez de que el componente conozca
  // los dos nombres de campo distintos.
  const departmentGroupRows: SpendGroupRow[] = departmentRows.map((row) => ({
    groupId: row.departmentId,
    groupName: row.departmentName,
    annualizedSpend: row.annualizedSpend,
    vendorCount: row.vendorCount,
  }));
  const companyGroupRows: SpendGroupRow[] = companyRows.map((row) => ({
    groupId: row.companyId,
    groupName: row.companyName,
    annualizedSpend: row.annualizedSpend,
    vendorCount: row.vendorCount,
  }));

  const monthlySpend = buildMonthlySpendSeries(
    (monthlySpendRows ?? []).map(
      (row: { spend_month: string; currency: string; total: number }): MonthlySpendRow => ({
        month: row.spend_month,
        currency: row.currency,
        total: Number(row.total),
      }),
    ),
    orgCurrency,
    rates,
    MONTHLY_SPEND_WINDOW,
  );

  return (
    <div>
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("title")}
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        {t("greeting", { name: profile.fullName ?? profile.orgName })}
      </p>

      <KpiCards kpis={kpis} locale={locale} orgCurrency={orgCurrency} />
      <RenewalTrack tickets={tickets} locale={locale} />

      <div className="mt-6 grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.6fr]">
        <StackStatusDonut summary={stackStatus} locale={locale} />
        <MonthlySpendChart
          points={monthlySpend.points}
          monthsWithData={monthlySpend.monthsWithData}
          locale={locale}
          orgCurrency={orgCurrency}
        />
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <SpendByGroupChart
          departmentRows={departmentGroupRows}
          companyRows={companyGroupRows}
          locale={locale}
          orgCurrency={orgCurrency}
        />
        <ReconciliationPreview rows={queue} totalPending={pendingCount ?? 0} locale={locale} />
      </div>
    </div>
  );
}
