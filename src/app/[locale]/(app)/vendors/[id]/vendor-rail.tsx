import { useTranslations } from "next-intl";
import { FichaField } from "@/components/ui/ficha-field";
import { actionableDaysUntil, annualizedCost } from "@/features/vendors/renewal";
import type { BillingCycle } from "@/features/vendors/types";

type PrimaryContract = {
  costAmount: number;
  currency: string;
  billingCycle: BillingCycle;
  renewalDate: string;
  autoRenews: boolean;
  cancellationNoticeDays: number;
} | null;

export function VendorRail({
  contract,
  locale,
}: {
  contract: PrimaryContract;
  locale: string;
}) {
  const t = useTranslations("Vendors.detail");
  const tBilling = useTranslations("Vendors.new");

  if (!contract) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">{t("rail.renewalTitle")}</h3>
          <p className="text-sm text-ink-soft">{t("rail.noActiveContract")}</p>
        </div>
      </div>
    );
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: contract.currency,
    maximumFractionDigits: 0,
  });

  const isCritical =
    actionableDaysUntil(contract.renewalDate, contract.autoRenews, contract.cancellationNoticeDays) <= 7;
  const billingCycleLabels: Record<string, string> = {
    monthly: tBilling("billingCycle.monthly"),
    annual: tBilling("billingCycle.annual"),
    one_time: tBilling("billingCycle.one_time"),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">{t("rail.renewalTitle")}</h3>
        <div className="flex flex-col gap-3">
          <FichaField
            label={tBilling("renewalDateLabel")}
            mono
            value={
              <span className={isCritical ? "text-destructive" : undefined}>
                {dateFormatter.format(new Date(`${contract.renewalDate}T00:00:00`))}
              </span>
            }
          />
          <FichaField label={tBilling("billingCycleLabel")} value={billingCycleLabels[contract.billingCycle]} />
          <FichaField
            label={tBilling("autoRenewsLabel")}
            value={contract.autoRenews ? t("rail.autoRenews") : t("rail.noAutoRenew")}
          />
          <FichaField
            label={tBilling("cancellationNoticeDaysLabel")}
            value={t("rail.noticeDays", { days: contract.cancellationNoticeDays })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">{t("rail.annualSpendTitle")}</h3>
        <p className="num text-2xl font-semibold text-ink">
          {currencyFormatter.format(annualizedCost(contract.costAmount, contract.billingCycle))}
        </p>
      </div>
    </div>
  );
}
