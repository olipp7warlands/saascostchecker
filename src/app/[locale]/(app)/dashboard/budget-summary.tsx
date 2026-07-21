import { getTranslations } from "next-intl/server";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { BudgetBucket } from "@/features/budgets/types";
import type { BudgetTone } from "@/features/budgets/thresholds";

const TONE_PILL: Record<BudgetTone, PillTone> = {
  stable: "green",
  upcoming: "amber",
  critical: "red",
};

const TONE_PRIORITY: Record<BudgetTone, number> = { critical: 3, upcoming: 2, stable: 1 };

// Resumen discreto (§E del diseño, ver docs/DECISIONS.md) — solo el peor
// semáforo entre bolsas presupuestadas, enlazando a /team/budgets para el
// desglose completo. Si la org no ha configurado ningún presupuesto todavía
// para el año en curso, no se muestra nada (no hay dato real que resumir).
export async function BudgetSummary({ buckets, locale }: { buckets: BudgetBucket[]; locale: string }) {
  const t = await getTranslations("Shell.dashboard.budgetSummary");

  const budgeted = buckets.filter((bucket) => bucket.budgetAmount != null && bucket.tone != null);
  if (budgeted.length === 0) {
    return null;
  }

  const totalConsumed = budgeted.reduce((sum, bucket) => sum + bucket.consumedAmount, 0);
  const totalBudget = budgeted.reduce((sum, bucket) => sum + (bucket.budgetAmount ?? 0), 0);
  const pct = totalBudget > 0 ? Math.round((totalConsumed / totalBudget) * 100) : 0;
  const worstTone = budgeted.reduce<BudgetTone>(
    (worst, bucket) => (TONE_PRIORITY[bucket.tone as BudgetTone] > TONE_PRIORITY[worst] ? (bucket.tone as BudgetTone) : worst),
    "stable",
  );

  return (
    <a
      href={`/${locale}/team/budgets`}
      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:border-ink-soft"
    >
      <span className="text-ink-soft">{t("label")}</span>
      <span className="flex items-center gap-2">
        <span className="num font-medium text-ink">{t("pct", { pct })}</span>
        <Pill tone={TONE_PILL[worstTone]}>{t(`tone.${worstTone}`)}</Pill>
      </span>
    </a>
  );
}
