"use client";

import { useTranslations } from "next-intl";
import { FichaField } from "@/components/ui/ficha-field";
import { annualizedCost } from "@/features/vendors/renewal";
import type { BillingCycle } from "@/features/vendors/types";
import { VendorEditForm } from "./vendor-edit-form";

type Vendor = {
  id: string;
  name: string;
  website: string;
  category: string;
  owner_user_id: string | null;
  status: string;
  notes: string | null;
};
type Member = { id: string; full_name: string | null; email: string };

type PrimaryContract = {
  costAmount: number;
  currency: string;
  billingCycle: BillingCycle;
  seatsPurchased: number | null;
  startDate: string;
  renewalDate: string;
  autoRenews: boolean;
  cancellationNoticeDays: number;
} | null;

export function DetailsTab({
  locale,
  vendor,
  members,
  companyName,
  departmentName,
  primaryContract,
  editMode,
  onToggleEdit,
}: {
  locale: string;
  vendor: Vendor;
  members: Member[];
  companyName: string | null;
  departmentName: string | null;
  primaryContract: PrimaryContract;
  editMode: boolean;
  onToggleEdit: () => void;
}) {
  const t = useTranslations("Vendors.detail");
  const tNew = useTranslations("Vendors.new");
  const tCategory = useTranslations("Catalog.category");

  if (editMode) {
    return <VendorEditForm locale={locale} vendor={vendor} members={members} />;
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const billingCycleLabels: Record<string, string> = {
    monthly: tNew("billingCycle.monthly"),
    annual: tNew("billingCycle.annual"),
    one_time: tNew("billingCycle.one_time"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{t("vendorFieldsTitle")}</h3>
        <button
          type="button"
          onClick={onToggleEdit}
          className="text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
        >
          {t("edit")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FichaField label={tNew("websiteLabel")} value={vendor.website} />
        <FichaField label={tNew("categoryLabel")} value={tCategory(vendor.category)} />
      </div>

      {vendor.notes && (
        <FichaField label={tNew("notesLabel")} value={<span className="whitespace-pre-wrap">{vendor.notes}</span>} />
      )}

      {primaryContract ? (
        <div className="border-t border-line pt-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">{t("tabs.contracts")}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FichaField
              label={tNew("costLabel")}
              mono
              value={new Intl.NumberFormat(locale, {
                style: "currency",
                currency: primaryContract.currency,
                maximumFractionDigits: 0,
              }).format(annualizedCost(primaryContract.costAmount, primaryContract.billingCycle))}
            />
            <FichaField label={tNew("billingCycleLabel")} value={billingCycleLabels[primaryContract.billingCycle]} />
            <FichaField label={tNew("seatsLabel")} mono value={primaryContract.seatsPurchased ?? "—"} />
            <FichaField
              label={tNew("startDateLabel")}
              value={dateFormatter.format(new Date(`${primaryContract.startDate}T00:00:00`))}
            />
            <FichaField
              label={tNew("renewalDateLabel")}
              value={dateFormatter.format(new Date(`${primaryContract.renewalDate}T00:00:00`))}
            />
            <FichaField
              label={tNew("autoRenewsLabel")}
              value={primaryContract.autoRenews ? t("rail.autoRenews") : t("rail.noAutoRenew")}
            />
            <FichaField label={tNew("companyLabel")} value={companyName ?? tNew("companyNone")} />
            <FichaField label={tNew("departmentLabel")} value={departmentName ?? tNew("departmentNone")} />
          </div>
        </div>
      ) : (
        <p className="border-t border-line pt-5 text-sm text-ink-soft">{t("noContracts")}</p>
      )}
    </div>
  );
}
