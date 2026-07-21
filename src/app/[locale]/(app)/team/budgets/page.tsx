import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { buildBudgetConsumption } from "@/features/budgets/aggregate";
import type { Budget, BudgetActiveContract, BudgetSpendRecord } from "@/features/budgets/types";
import { getCurrentUserProfile } from "@/features/auth/session";
import type { ExchangeRate } from "@/features/dashboard/types";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { BudgetBucketRow, type BucketView } from "./budget-bucket-row";
import { BudgetForm } from "./budget-form";
import { FiscalYearSelect } from "./fiscal-year-select";

const READ_ROLES = ["finance", "it_admin", "org_admin"];
const WRITE_ROLES = ["finance", "org_admin"];

export default async function BudgetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Budgets");
  const profile = await getCurrentUserProfile();

  if (!profile || !READ_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const canWrite = WRITE_ROLES.includes(profile.role);
  const today = new Date();
  const { year: yearParam } = await searchParams;
  const fiscalYear = yearParam ? Number.parseInt(yearParam, 10) : today.getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => today.getFullYear() - 3 + i);

  const supabase = await createClient();
  const [
    { data: org },
    { data: companies },
    { data: departments },
    { data: budgetRows },
    { data: rateRows },
    { data: contractRows },
    { data: spendRows },
    { data: vendors },
  ] = await Promise.all([
    supabase.from("organizations").select("default_currency").eq("id", profile.orgId).single(),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("budgets").select("id, company_id, department_id, fiscal_year, amount, currency"),
    supabase.from("exchange_rates").select("base_currency, quote_currency, rate"),
    supabase
      .from("contracts")
      .select("vendor_id, department_id, company_id")
      .eq("status", "active"),
    supabase
      .from("spend_records")
      .select("vendor_id, amount, currency, date")
      .not("vendor_id", "is", null)
      .gte("date", `${fiscalYear}-01-01`)
      .lte("date", `${fiscalYear}-12-31`),
    supabase.from("vendors").select("id, name"),
  ]);

  const orgCurrency = org?.default_currency ?? "EUR";
  const rates: ExchangeRate[] = (rateRows ?? []).map((row) => ({
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
  }));

  const budgets: Budget[] = (budgetRows ?? []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    departmentId: row.department_id,
    fiscalYear: row.fiscal_year,
    amount: Number(row.amount),
    currency: row.currency,
  }));
  const activeContracts: BudgetActiveContract[] = (contractRows ?? []).map((row) => ({
    vendorId: row.vendor_id,
    companyId: row.company_id,
    departmentId: row.department_id,
  }));
  const spendRecords: BudgetSpendRecord[] = (spendRows ?? []).map((row) => ({
    vendorId: row.vendor_id as string,
    amount: Number(row.amount),
    currency: row.currency,
    date: row.date,
  }));

  const buckets = buildBudgetConsumption(
    spendRecords,
    activeContracts,
    budgets,
    orgCurrency,
    rates,
    fiscalYear,
    today,
  );

  const companyNameById = new Map((companies ?? []).map((company) => [company.id, company.name]));
  const departmentNameById = new Map((departments ?? []).map((department) => [department.id, department.name]));
  const vendorNameById = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.name]));

  function scopeLabel(companyId: string | null, departmentId: string | null): string {
    const companyName = companyId ? (companyNameById.get(companyId) ?? null) : null;
    const departmentName = departmentId ? (departmentNameById.get(departmentId) ?? null) : null;

    if (companyName && departmentName) {
      return t("scope.both", { company: companyName, department: departmentName });
    }
    if (departmentName) {
      return t("scope.departmentAllCompanies", { department: departmentName });
    }
    if (companyName) {
      return t("scope.companyAllDepartments", { company: companyName });
    }
    return t("scope.unassigned");
  }

  const bucketViews: BucketView[] = buckets.map((bucket) => ({
    key: bucket.key,
    budgetId: bucket.budgetId,
    scopeLabel: scopeLabel(bucket.companyId, bucket.departmentId),
    budgetAmount: bucket.budgetAmount,
    budgetCurrency: bucket.budgetCurrency,
    consumedAmount: bucket.consumedAmount,
    projectedYearEnd: bucket.projectedYearEnd,
    tone: bucket.tone,
    vendors: bucket.vendors.map((vendor) => ({
      name: vendorNameById.get(vendor.vendorId) ?? vendor.vendorId,
      amount: vendor.amount,
    })),
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div>
        <Breadcrumbs items={[{ label: t("crumb") }]} />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
            {t("title")}
          </h1>
          <FiscalYearSelect currentYear={fiscalYear} years={years} />
        </div>
      </div>

      {canWrite && (
        <BudgetForm
          fiscalYear={fiscalYear}
          orgCurrency={orgCurrency}
          companies={companies ?? []}
          departments={departments ?? []}
        />
      )}

      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("listTitle")}</h2>
        {bucketViews.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {bucketViews.map((bucket) => (
              <BudgetBucketRow
                key={bucket.key}
                bucket={bucket}
                orgCurrency={orgCurrency}
                canWrite={canWrite}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
