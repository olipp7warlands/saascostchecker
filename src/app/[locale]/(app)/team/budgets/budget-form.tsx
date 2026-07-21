"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBudget } from "@/features/budgets/actions";

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Option = { id: string; name: string };

export function BudgetForm({
  fiscalYear,
  orgCurrency,
  companies,
  departments,
}: {
  fiscalYear: number;
  orgCurrency: string;
  companies: Option[];
  departments: Option[];
}) {
  const t = useTranslations("Budgets");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createBudget({
        companyId: formData.get("companyId"),
        departmentId: formData.get("departmentId"),
        fiscalYear: formData.get("fiscalYear"),
        amount: formData.get("amount"),
        currency: formData.get("currency"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        (document.getElementById("budget-form") as HTMLFormElement | null)?.reset();
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h2 className="font-disp text-lg font-semibold text-ink">{t("createTitle")}</h2>
      <p className="mt-1 text-xs text-ink-soft">{t("createHint")}</p>

      <form id="budget-form" action={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="companyId">{t("companyLabel")}</Label>
          <select id="companyId" name="companyId" defaultValue="" className={SELECT_CLASSNAME}>
            <option value="">{t("allCompanies")}</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="departmentId">{t("departmentLabel")}</Label>
          <select id="departmentId" name="departmentId" defaultValue="" className={SELECT_CLASSNAME}>
            <option value="">{t("allDepartments")}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fiscalYear">{t("fiscalYearLabel")}</Label>
          <Input
            id="fiscalYear"
            name="fiscalYear"
            type="number"
            required
            defaultValue={fiscalYear}
            className="w-24"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="amount">{t("amountLabel")}</Label>
          <Input id="amount" name="amount" type="number" min={0} step="0.01" required className="w-32" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">{t("currencyLabel")}</Label>
          <Input id="currency" name="currency" maxLength={3} required defaultValue={orgCurrency} className="w-20" />
        </div>

        <Button type="submit" disabled={isPending}>
          {t("create")}
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
