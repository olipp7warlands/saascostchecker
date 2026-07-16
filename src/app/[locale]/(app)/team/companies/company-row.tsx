"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCompany, updateCompany } from "@/features/companies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Company = { id: string; name: string; tax_id: string | null; is_default: boolean };

export function CompanyRow({ company }: { company: Company }) {
  const t = useTranslations("Team.companies");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCompany({
        companyId: company.id,
        name: formData.get("name"),
        taxId: formData.get("taxId"),
        isDefault: formData.get("isDefault") === "on",
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCompany(company.id);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <form action={handleSave} className="flex flex-wrap items-center gap-2">
        <Input
          name="name"
          defaultValue={company.name}
          required
          minLength={1}
          maxLength={200}
          className="max-w-[10rem]"
        />
        <Input
          name="taxId"
          defaultValue={company.tax_id ?? ""}
          maxLength={50}
          placeholder={t("taxIdLabel")}
          className="max-w-[8rem]"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input
            name="isDefault"
            type="checkbox"
            defaultChecked={company.is_default}
            className="size-4"
          />
          {t("isDefaultLabel")}
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {t("edit")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={handleDelete}
        >
          {t("delete")}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}
