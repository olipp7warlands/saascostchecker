"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCompany } from "@/features/companies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CompanyForm() {
  const t = useTranslations("Team.companies");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createCompany({
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

  return (
    <div>
      <h1 className="font-disp text-xl font-semibold text-ink">{t("title")}</h1>

      <form action={handleSubmit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input id="name" name="name" required minLength={1} maxLength={200} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxId">{t("taxIdLabel")}</Label>
          <Input id="taxId" name="taxId" maxLength={50} />
        </div>

        <div className="flex items-center gap-2">
          <input id="isDefault" name="isDefault" type="checkbox" className="size-4" />
          <Label htmlFor="isDefault">{t("isDefaultLabel")}</Label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={isPending} className="w-fit">
          {t("create")}
        </Button>
      </form>
    </div>
  );
}
