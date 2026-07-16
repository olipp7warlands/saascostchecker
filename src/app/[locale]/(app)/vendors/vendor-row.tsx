import { getTranslations } from "next-intl/server";
import { AppLogo } from "@/components/catalog/app-logo";
import { Avatar } from "@/components/ui/avatar";
import { Pill, type PillTone } from "@/components/ui/pill";
import { UtilizationBar } from "@/components/ui/utilization-bar";
import type { CatalogCategory } from "@/features/catalog/types";
import { annualizedCost, daysUntil, renewalTone } from "@/features/vendors/renewal";
import { seatUtilizationPct, utilizationTone } from "@/features/vendors/seats";
import type { BillingCycle, VendorStatus } from "@/features/vendors/types";
import { VendorRowActions } from "./vendor-row-actions";

export type VendorRowData = {
  id: string;
  name: string;
  website: string;
  category: CatalogCategory;
  status: VendorStatus;
  isCustom: boolean;
  ownerName: string | null;
  contract: {
    costAmount: number;
    currency: string;
    billingCycle: BillingCycle;
    seatsPurchased: number | null;
    renewalDate: string;
    activeSeats: number;
  } | null;
};

const RENEWAL_TONE_MAP: Record<string, PillTone> = {
  red: "red",
  amber: "amber",
  neutral: "neutral",
};

const STATUS_DOT_CLASS: Record<VendorStatus, string> = {
  active: "bg-success",
  trial: "bg-warning",
  inactive: "bg-ink-soft",
};

export async function VendorRow({ vendor, locale }: { vendor: VendorRowData; locale: string }) {
  const t = await getTranslations("Vendors");
  const tCategory = await getTranslations("Catalog.category");
  const tGeneric = await getTranslations("Auth");

  const currencyFormatter = vendor.contract
    ? new Intl.NumberFormat(locale, {
        style: "currency",
        currency: vendor.contract.currency,
        maximumFractionDigits: 0,
      })
    : null;

  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  const seatsPurchased = vendor.contract?.seatsPurchased ?? null;
  const utilizationPct =
    vendor.contract && seatsPurchased != null
      ? seatUtilizationPct(vendor.contract.activeSeats, seatsPurchased)
      : null;

  const billingCycleLabel = vendor.contract ? t(`new.billingCycle.${vendor.contract.billingCycle}`) : null;

  return (
    <tr className="hover:bg-muted/40">
      <td className="border-b border-line px-4 py-3">
        <a
          href={`/${locale}/vendors/${vendor.id}`}
          className="flex items-center gap-2.5 font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
        >
          <AppLogo domain={vendor.website} name={vendor.name} size={26} />
          <span className="flex flex-col">
            <span className="flex items-center gap-2 whitespace-nowrap">
              {vendor.name}
              {vendor.isCustom && <Pill tone="neutral">{t("custom")}</Pill>}
            </span>
            <span className="text-xs font-normal text-ink-soft no-underline">
              {tCategory(vendor.category)}
            </span>
          </span>
        </a>
      </td>
      <td className="border-b border-line px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm text-ink-soft">
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 rounded-full ${STATUS_DOT_CLASS[vendor.status]}`}
          />
          {t(`detail.status.${vendor.status}`)}
        </span>
      </td>
      <td className="num border-b border-line px-4 py-3 text-sm text-ink">
        {vendor.contract && currencyFormatter ? (
          <span className="flex flex-col">
            <span>
              {currencyFormatter.format(
                annualizedCost(vendor.contract.costAmount, vendor.contract.billingCycle),
              )}
            </span>
            <span className="text-xs font-normal text-ink-soft">{billingCycleLabel}</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="num border-b border-line px-4 py-3 text-sm text-ink">
        {vendor.contract?.seatsPurchased ?? "—"}
      </td>
      <td className="border-b border-line px-4 py-3">
        {vendor.contract && utilizationPct != null ? (
          <div
            className="flex items-center gap-2"
            title={`${vendor.contract.activeSeats} / ${seatsPurchased}`}
          >
            <UtilizationBar pct={utilizationPct} tone={utilizationTone(utilizationPct)} />
            <span className="num text-xs text-ink-soft">{utilizationPct}%</span>
          </div>
        ) : (
          <span className="text-xs text-ink-soft">{t("noData")}</span>
        )}
      </td>
      <td className="border-b border-line px-4 py-3">
        {vendor.contract ? (
          <Pill tone={RENEWAL_TONE_MAP[renewalTone(daysUntil(vendor.contract.renewalDate))]}>
            {dateFormatter.format(new Date(`${vendor.contract.renewalDate}T00:00:00`))} ·{" "}
            {daysUntil(vendor.contract.renewalDate)}d
          </Pill>
        ) : (
          <span className="text-sm text-ink-soft">—</span>
        )}
      </td>
      <td className="border-b border-line px-4 py-3 text-sm text-ink">
        {vendor.ownerName ? (
          <div className="flex items-center gap-2">
            <Avatar name={vendor.ownerName} size={22} />
            <span>{vendor.ownerName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Avatar name={null} size={22} />
            <Pill tone="red">{t("noOwner")}</Pill>
          </div>
        )}
      </td>
      <td className="border-b border-line px-2 py-3 text-right">
        <VendorRowActions
          vendorId={vendor.id}
          locale={locale}
          labels={{
            menuLabel: t("detail.actions"),
            edit: t("detail.edit"),
            delete: t("detail.deleteVendor"),
            confirmTitle: t("detail.confirmDeleteVendorTitle"),
            confirmDescription: t("detail.confirmDeleteVendor"),
            cancel: tGeneric("cancel"),
            errorGeneric: tGeneric("errorGeneric"),
          }}
        />
      </td>
    </tr>
  );
}
