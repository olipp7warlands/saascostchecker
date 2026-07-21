"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { BudgetBar } from "@/components/ui/budget-bar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { BudgetTone } from "@/features/budgets/thresholds";
import { deleteBudget, updateBudget } from "@/features/budgets/actions";

export type BucketView = {
  key: string;
  budgetId: string | null;
  scopeLabel: string;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  consumedAmount: number;
  projectedYearEnd: number | null;
  tone: BudgetTone | null;
  vendors: { name: string; amount: number }[];
};

const TONE_PILL: Record<BudgetTone, PillTone> = {
  stable: "green",
  upcoming: "amber",
  critical: "red",
};

export function BudgetBucketRow({
  bucket,
  orgCurrency,
  canWrite,
  locale,
}: {
  bucket: BucketView;
  orgCurrency: string;
  canWrite: boolean;
  locale: string;
}) {
  const t = useTranslations("Budgets");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

  const pct = bucket.budgetAmount ? (bucket.consumedAmount / bucket.budgetAmount) * 100 : 0;

  function handleSave(formData: FormData) {
    if (!bucket.budgetId) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBudget({
        budgetId: bucket.budgetId,
        amount: formData.get("amount"),
        currency: formData.get("currency"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setEditMode(false);
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!bucket.budgetId) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBudget(bucket.budgetId as string);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
      setConfirmOpen(false);
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{bucket.scopeLabel}</p>
          {!bucket.budgetId && (
            <p className="mt-0.5 text-xs text-ink-soft">{t("noBudgetForScope")}</p>
          )}
        </div>
        {bucket.tone && <Pill tone={TONE_PILL[bucket.tone]}>{t(`tone.${bucket.tone}`)}</Pill>}
      </div>

      <BudgetBar pct={pct} tone={bucket.tone} />

      {editMode && bucket.budgetId ? (
        <form action={handleSave} className="flex flex-wrap items-center gap-2">
          <Input
            name="amount"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={bucket.budgetAmount ?? undefined}
            className="max-w-[9rem]"
          />
          <Input
            name="currency"
            maxLength={3}
            required
            defaultValue={bucket.budgetCurrency ?? orgCurrency}
            className="max-w-[5rem]"
          />
          <Button type="submit" size="sm" disabled={isPending}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditMode(false)}>
            {tGeneric("cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="num text-ink">
            {money(bucket.consumedAmount, orgCurrency)}
            {bucket.budgetAmount != null && (
              <span className="text-ink-soft"> / {money(bucket.budgetAmount, bucket.budgetCurrency ?? orgCurrency)}</span>
            )}
          </span>
          {bucket.projectedYearEnd != null && (
            <span className="num text-xs text-ink-soft">
              {t("projected", { amount: money(bucket.projectedYearEnd, orgCurrency) })}
            </span>
          )}
        </div>
      )}

      {canWrite && bucket.budgetId && !editMode && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditMode(true)}>
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("delete")}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {bucket.vendors.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink underline underline-offset-4">
            {t("vendorBreakdown", { count: bucket.vendors.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {bucket.vendors.map((vendor) => (
              <li key={vendor.name} className="flex items-center justify-between text-ink-soft">
                <span>{vendor.name}</span>
                <span className="num">{money(vendor.amount, orgCurrency)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmDeleteTitle")}
        description={t("confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </li>
  );
}
