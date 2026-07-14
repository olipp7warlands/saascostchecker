import { getTranslations } from "next-intl/server";
import type { DashboardKpis } from "@/features/dashboard/types";
import { cn } from "@/lib/utils";

function Kpi({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-line bg-surface p-4">
      <div className="mb-1.5 text-xs text-ink-soft">{label}</div>
      <div className="num text-[22px] font-semibold tracking-tight text-ink">{value}</div>
      <div className={cn("mt-1 text-xs", warn ? "text-[#B27A1E]" : "text-ink-soft")}>{sub}</div>
    </div>
  );
}

export async function KpiCards({
  kpis,
  locale,
  orgCurrency,
}: {
  kpis: DashboardKpis;
  locale: string;
  orgCurrency: string;
}) {
  const t = await getTranslations("Shell.dashboard.kpis");
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: orgCurrency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi
        label={t("annualizedSpend.label")}
        value={currencyFormatter.format(kpis.annualizedSpend)}
        sub={t("annualizedSpend.sub", {
          contracts: kpis.activeContractCount,
          currencies: kpis.currencyCount,
        })}
        warn={false}
      />
      <Kpi
        label={t("activeVendors.label")}
        value={String(kpis.activeVendorCount)}
        sub={t("activeVendors.sub", { count: kpis.vendorsWithoutOwnerCount })}
        warn={kpis.vendorsWithoutOwnerCount > 0}
      />
      <Kpi
        label={t("wastedLicenses.label")}
        value={currencyFormatter.format(kpis.wastedLicenseCost)}
        sub={t("wastedLicenses.sub", { count: kpis.idleSeatCount })}
        warn={kpis.idleSeatCount > 0}
      />
      <Kpi
        label={t("renewals90.label")}
        value={String(kpis.renewalsNext90)}
        sub={t("renewals90.sub", { count: kpis.renewalsNext30 })}
        warn={kpis.renewalsNext30 > 0}
      />
    </div>
  );
}
