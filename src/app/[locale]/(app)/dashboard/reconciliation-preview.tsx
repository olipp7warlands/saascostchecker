import { getTranslations } from "next-intl/server";
import { Pill } from "@/components/ui/pill";
import type { ReconciliationPreviewRow } from "@/features/dashboard/types";

export async function ReconciliationPreview({
  rows,
  totalPending,
  locale,
}: {
  rows: ReconciliationPreviewRow[];
  totalPending: number;
  locale: string;
}) {
  const t = await getTranslations("Shell.dashboard.reconciliation");
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-disp text-base font-semibold text-ink">{t("title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => {
              const amountFormatter = new Intl.NumberFormat(locale, {
                style: "currency",
                currency: row.currency,
              });
              return (
                <li key={row.id} className="flex items-start justify-between gap-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{row.rawDescription}</p>
                    <p className="text-xs text-ink-soft">
                      {row.date ? dateFormatter.format(new Date(`${row.date}T00:00:00`)) : "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num text-ink">{amountFormatter.format(row.amount)}</span>
                    {row.suggestedName && (
                      <Pill tone="amber">{t("suggestion", { name: row.suggestedName })}</Pill>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3.5 rounded-lg border border-amber-soft bg-amber-soft p-3 text-[13px] text-ink">
            {t("note", { count: totalPending })}{" "}
            <a href={`/${locale}/reconciliation`} className="font-semibold text-primary hover:underline">
              {t("viewAll")}
            </a>
          </div>
        </>
      )}
    </div>
  );
}
