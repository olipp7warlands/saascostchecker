"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AppLogo } from "@/components/catalog/app-logo";
import { SaasCombobox } from "@/components/catalog/saas-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import type { SaasCatalogEntry } from "@/features/catalog/types";
import { checkCatalogOverlap, createPurchaseRequest } from "@/features/requests/actions";
import type { CatalogOverlapResult } from "@/features/requests/catalog-overlap";
import { CatalogOverlapBanner } from "../catalog-overlap-banner";

type Department = { id: string; name: string };

type RequestSelection = {
  catalogId: string | null;
  name: string;
  website: string;
  isCustom: boolean;
};

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NewRequestForm({
  locale,
  departments,
  callerDepartmentId,
  defaultCurrency,
}: {
  locale: string;
  departments: Department[];
  callerDepartmentId: string | null;
  defaultCurrency: string;
}) {
  const t = useTranslations("Requests.new");
  const tGeneric = useTranslations("Auth");
  const [selection, setSelection] = useState<RequestSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [overlap, setOverlap] = useState<CatalogOverlapResult | null>(null);
  const [costInput, setCostInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState(defaultCurrency);

  function handleSelectCatalog(entry: SaasCatalogEntry) {
    setSelection({ catalogId: entry.id, name: entry.name, website: entry.website, isCustom: false });
    setOverlap(null);
    startTransition(async () => {
      const result = await checkCatalogOverlap(entry.id);
      if ("success" in result) {
        setOverlap(result.data);
      }
    });
  }

  function handleCreateCustom(query: string) {
    // Sin catalog_id, sin nada que comparar contra el stack existente —
    // misma limitación asumida en 3.3 para herramientas custom.
    setSelection({ catalogId: null, name: query, website: "", isCustom: true });
    setOverlap(null);
  }

  function handleSubmit(formData: FormData) {
    if (!selection) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createPurchaseRequest(locale, {
        catalogId: selection.catalogId,
        vendorName: selection.name,
        estimatedAnnualCost: formData.get("estimatedAnnualCost"),
        currency: formData.get("currency"),
        departmentId: formData.get("departmentId"),
        justification: formData.get("justification"),
        alternativesConsidered: formData.get("alternativesConsidered"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      }
    });
  }

  if (!selection) {
    return (
      <div>
        <Label>{t("vendorSection")}</Label>
        <div className="mt-1.5">
          <SaasCombobox onSelect={handleSelectCatalog} onCreateCustom={handleCreateCustom} />
        </div>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t("vendorSection")}</legend>
        <div className="flex items-center gap-3">
          <AppLogo domain={selection.website || null} name={selection.name} size={32} />
          <span className="font-medium text-ink">{selection.name}</span>
          {selection.isCustom ? (
            <Pill tone="neutral">{t("customBadge")}</Pill>
          ) : (
            <span className="text-xs text-ink-soft">{t("selectedFrom")}</span>
          )}
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="ml-auto text-xs font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
          >
            {t("changeSelection")}
          </button>
        </div>

        {overlap && (
          <CatalogOverlapBanner
            overlap={overlap}
            requestedAnnualCost={costInput ? Number(costInput) : null}
            requestedCurrency={currencyInput || defaultCurrency}
            variant="new"
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="estimatedAnnualCost">{t("costLabel")}</Label>
            <Input
              id="estimatedAnnualCost"
              name="estimatedAnnualCost"
              type="number"
              min={0}
              step="0.01"
              required
              value={costInput}
              onChange={(event) => setCostInput(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency">{t("currencyLabel")}</Label>
            <Input
              id="currency"
              name="currency"
              required
              maxLength={3}
              value={currencyInput}
              onChange={(event) => setCurrencyInput(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="departmentId">{t("departmentLabel")}</Label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={callerDepartmentId ?? ""}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t("noDepartmentOption")}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="justification">{t("justificationLabel")}</Label>
          <textarea
            id="justification"
            name="justification"
            required
            rows={3}
            maxLength={2000}
            className="rounded-input border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alternativesConsidered">{t("alternativesLabel")}</Label>
          <textarea
            id="alternativesConsidered"
            name="alternativesConsidered"
            rows={2}
            maxLength={2000}
            className="rounded-input border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}
