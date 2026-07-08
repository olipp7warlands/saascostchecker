import { getTranslations } from "next-intl/server";
import { AppLogo } from "@/components/catalog/app-logo";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { CatalogCategory } from "@/features/catalog/types";
import { annualizedCost, daysUntil, renewalTone } from "@/features/vendors/renewal";
import type { BillingCycle } from "@/features/vendors/types";

export type VendorRowData = {
  id: string;
  name: string;
  website: string;
  category: CatalogCategory;
  isCustom: boolean;
  ownerName: string | null;
  contract: {
    costAmount: number;
    currency: string;
    billingCycle: BillingCycle;
    seatsPurchased: number | null;
    renewalDate: string;
  } | null;
};

const RENEWAL_TONE_MAP: Record<string, PillTone> = {
  red: "red",
  amber: "amber",
  neutral: "neutral",
};

export async function VendorRow({ vendor, locale }: { vendor: VendorRowData; locale: string }) {
  const t = await getTranslations("Vendors");
  const tCategory = await getTranslations("Catalog.category");

  const currencyFormatter = vendor.contract
    ? new Intl.NumberFormat(locale, {
        style: "currency",
        currency: vendor.contract.currency,
        maximumFractionDigits: 0,
      })
    : null;

  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  return (
    <tr className="hover:bg-muted/40">
      <td className="border-b border-line px-4 py-3">
        <a
          href={`/${locale}/vendors/${vendor.id}`}
          className="flex items-center gap-2.5 font-medium text-ink hover:text-primary"
        >
          <AppLogo domain={vendor.website} name={vendor.name} size={26} />
          <span className="whitespace-nowrap">{vendor.name}</span>
          {vendor.isCustom && <Pill tone="neutral">{t("custom")}</Pill>}
        </a>
      </td>
      <td className="border-b border-line px-4 py-3 text-sm text-ink-soft">
        {tCategory(vendor.category)}
      </td>
      <td className="num border-b border-line px-4 py-3 text-sm text-ink">
        {vendor.contract && currencyFormatter
          ? currencyFormatter.format(
              annualizedCost(vendor.contract.costAmount, vendor.contract.billingCycle),
            )
          : "—"}
      </td>
      <td className="num border-b border-line px-4 py-3 text-sm text-ink">
        {vendor.contract?.seatsPurchased ?? "—"}
      </td>
      <td className="border-b border-line px-4 py-3 text-xs text-ink-soft">{t("noData")}</td>
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
        {vendor.ownerName ?? <Pill tone="red">{t("noOwner")}</Pill>}
      </td>
    </tr>
  );
}
