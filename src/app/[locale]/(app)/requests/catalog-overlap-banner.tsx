"use client";

import { useLocale, useTranslations } from "next-intl";
import { AppLogo } from "@/components/catalog/app-logo";
import type { CatalogOverlapResult } from "@/features/requests/catalog-overlap";
import { annualizedCost } from "@/features/vendors/renewal";

// Bloque 3.4 — banner compartido entre el formulario de nueva solicitud
// (variant "new", coste en vivo mientras el usuario escribe) y el detalle de
// la solicitud (variant "detail", visible al aprobador cuando known_overlap
// es true). check_catalog_overlap() ya decidió server-side si `contracts[]`
// trae importes (MANAGER_ROLES) o no (cualquier otro rol) — este componente
// solo renderiza lo que llegó, nunca decide el nivel de detalle.
export function CatalogOverlapBanner({
  overlap,
  requestedAnnualCost,
  requestedCurrency,
  variant,
}: {
  overlap: CatalogOverlapResult;
  requestedAnnualCost: number | null;
  requestedCurrency: string;
  variant: "new" | "detail";
}) {
  const t = useTranslations("Requests.overlap");
  const locale = useLocale();

  if (!overlap.hasOverlap) {
    return null;
  }

  const isManagerLevel = overlap.contracts.some((c) => c.costAmount !== null);
  const ownerNames = Array.from(
    new Set(overlap.contracts.map((c) => c.ownerName).filter((name): name is string => !!name)),
  );

  const savingsFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: requestedCurrency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="rounded-lg border border-warning bg-warning-soft p-3.5">
      <p className="text-sm font-semibold text-warning">{t("title")}</p>

      {variant === "detail" && <p className="mt-1 text-xs text-warning">{t("detailIntro")}</p>}

      {!isManagerLevel && (
        <p className="mt-1.5 text-sm text-ink">
          {ownerNames.length > 0
            ? t("basicBodyWithOwner", {
                count: overlap.activeContractCount,
                owner: ownerNames.join(", "),
              })
            : t("basicBodyNoOwner", { count: overlap.activeContractCount })}
        </p>
      )}

      {isManagerLevel && (
        <div className="mt-2 flex flex-col gap-2">
          {overlap.contracts.map((contract, index) => (
            <div
              key={`${contract.vendorId}-${index}`}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2"
            >
              <AppLogo domain={contract.vendorWebsite || null} name={contract.vendorName} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{contract.vendorName}</p>
                <p className="truncate text-xs text-ink-soft">
                  {contract.departmentName ?? t("noDepartment")}
                  {contract.companyName ? ` · ${contract.companyName}` : ""}
                  {" · "}
                  {contract.ownerName ?? t("noOwner")}
                </p>
              </div>
              {contract.costAmount !== null && contract.currency && contract.billingCycle && (
                <span className="num shrink-0 text-sm font-semibold text-ink">
                  {new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: contract.currency,
                    maximumFractionDigits: 0,
                  }).format(annualizedCost(contract.costAmount, contract.billingCycle))}
                  /{t("perYear")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {isManagerLevel && requestedAnnualCost !== null && (
        <div className="mt-3 border-t border-warning/30 pt-2.5">
          <p className="text-xs font-semibold tracking-wider text-warning uppercase">
            {t("potentialSavingsLabel")}
          </p>
          <p className="num mt-0.5 text-base font-semibold text-ink">
            {savingsFormatter.format(requestedAnnualCost)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">{t("potentialSavingsNote")}</p>
        </div>
      )}
    </div>
  );
}
