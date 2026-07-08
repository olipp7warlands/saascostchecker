"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AppLogo } from "@/components/catalog/app-logo";
import { SaasCombobox } from "@/components/catalog/saas-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { CATALOG_CATEGORIES, type SaasCatalogEntry } from "@/features/catalog/types";
import { createVendorWithContract } from "@/features/vendors/actions";
import { ContractFields } from "../contract-fields";

type Member = { id: string; full_name: string | null; email: string };

type VendorSelection = {
  catalogId: string | null;
  name: string;
  website: string;
  category: string;
  isCustom: boolean;
};

export function NewVendorForm({ locale, members }: { locale: string; members: Member[] }) {
  const t = useTranslations("Vendors.new");
  const tGeneric = useTranslations("Auth");
  const tCategory = useTranslations("Catalog.category");
  const [selection, setSelection] = useState<VendorSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelectCatalog(entry: SaasCatalogEntry) {
    setSelection({
      catalogId: entry.id,
      name: entry.name,
      website: entry.website,
      category: entry.category,
      isCustom: false,
    });
  }

  function handleCreateCustom(query: string) {
    setSelection({
      catalogId: null,
      name: query,
      website: "",
      category: "other",
      isCustom: true,
    });
  }

  function handleSubmit(formData: FormData) {
    if (!selection) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createVendorWithContract(locale, {
        catalogId: selection.catalogId,
        vendorName: formData.get("vendorName"),
        website: formData.get("website"),
        category: formData.get("category"),
        isCustom: selection.isCustom,
        ownerUserId: formData.get("ownerUserId"),
        notes: formData.get("notes"),
        contractName: formData.get("contractName"),
        costAmount: formData.get("costAmount"),
        currency: formData.get("currency"),
        billingCycle: formData.get("billingCycle"),
        seatsPurchased: formData.get("seatsPurchased"),
        startDate: formData.get("startDate"),
        renewalDate: formData.get("renewalDate"),
        autoRenews: formData.get("autoRenews") === "on",
        cancellationNoticeDays: formData.get("cancellationNoticeDays"),
        document: formData.get("document"),
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
          {selection.isCustom ? (
            <Pill tone="neutral">{t("customBadge")}</Pill>
          ) : (
            <span className="text-xs text-ink-soft">{t("selectedFrom")}</span>
          )}
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            {t("changeSelection")}
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendorName">{t("nameLabel")}</Label>
          <Input
            id="vendorName"
            name="vendorName"
            required
            minLength={1}
            maxLength={200}
            defaultValue={selection.name}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="website">{t("websiteLabel")}</Label>
          <Input
            id="website"
            name="website"
            required
            maxLength={255}
            placeholder="ejemplo.com"
            defaultValue={selection.website}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category">{t("categoryLabel")}</Label>
          <select
            id="category"
            name="category"
            required
            defaultValue={selection.category}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {CATALOG_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {tCategory(category)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ownerUserId">{t("ownerLabel")}</Label>
          <select
            id="ownerUserId"
            name="ownerUserId"
            defaultValue=""
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{t("noOwnerOption")}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">{t("notesLabel")}</Label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            maxLength={2000}
            className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t("contractSection")}</legend>
        <ContractFields idPrefix="new" defaultValues={{ contractName: selection.name }} />
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}
