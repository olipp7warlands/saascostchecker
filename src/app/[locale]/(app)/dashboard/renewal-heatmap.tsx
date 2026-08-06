"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControlItem, SegmentedControlList } from "@/components/ui/segmented-control";
import { Tabs } from "@/components/ui/tabs";
import {
  buildRenewalHeatmapWeeks,
  defaultHeatmapWeekIndex,
  summarizeRenewalHeatmap,
} from "@/features/dashboard/aggregate";
import { HEATMAP_CELL_CLASSES, HEATMAP_EMPTY_CELL_CLASSES } from "@/features/dashboard/renewal-heatmap-classes";
import type { RenewalHeatmapWeek, RenewalTicket } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";
import type { RenewalTone } from "@/features/vendors/renewal";
import { cn } from "@/lib/utils";
import { RenewalHeatmapPanel } from "./renewal-heatmap-panel";

const RANGE_OPTIONS = [30, 60, 90, 120];

// Reutiliza literalmente el vocabulario ya existente de Shell.dashboard.stackStatus
// (Crítico/Próximo/Estable) para el aria-label de la celda — cero vocabulario nuevo.
const TONE_TO_STACK_STATUS_KEY: Record<RenewalTone, "critical" | "upcoming" | "stable"> = {
  red: "critical",
  amber: "upcoming",
  neutral: "stable",
};

function HeatmapCell({
  week,
  active,
  dateLabel,
  onSelect,
  t,
}: {
  week: RenewalHeatmapWeek;
  active: boolean;
  dateLabel: string;
  onSelect: (index: number) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const count = week.tickets.length;
  const toneLabel = t(`stackStatus.${TONE_TO_STACK_STATUS_KEY[week.tone]}`);

  return (
    <button
      type="button"
      onClick={() => onSelect(week.index)}
      aria-pressed={active}
      aria-label={t("heatmap.cellAriaLabel", { date: dateLabel, tone: toneLabel, count })}
      title={t("heatmap.cellTooltip", { date: dateLabel, count })}
      className={cn(
        "h-10 rounded-[6px] border outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        count === 0 ? HEATMAP_EMPTY_CELL_CLASSES : HEATMAP_CELL_CLASSES[week.tone][week.intensity!],
        active && "ring-2 ring-offset-1 ring-[var(--ring)]",
      )}
    />
  );
}

export function RenewalHeatmap({
  tickets,
  locale,
  orgCurrency,
}: {
  tickets: RenewalTicket[];
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard");
  const [rangeDays, setRangeDays] = useState(120);
  // Snapshot estable de "hoy" para todo el ciclo de vida del componente,
  // mismo patrón que renewals-calendar.tsx — evita que el bucketing cambie
  // de semana a mitad de sesión si el usuario deja la pestaña abierta.
  const [today] = useState(() => new Date());
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);

  const weeks = useMemo(() => buildRenewalHeatmapWeeks(tickets, rangeDays, today), [tickets, rangeDays, today]);
  const summary = useMemo(() => summarizeRenewalHeatmap(weeks), [weeks]);

  // Valor derivado, no estado: si el rango se encoge y el índice seleccionado
  // ya no cabe en `weeks`, recalcula el default (primera semana con
  // contenido) en el mismo render — sin useEffect.
  const activeWeekIndex = useMemo(
    () => (selectedWeekIndex != null && selectedWeekIndex < weeks.length ? selectedWeekIndex : defaultHeatmapWeekIndex(weeks)),
    [selectedWeekIndex, weeks],
  );
  const activeWeek = activeWeekIndex != null ? weeks[activeWeekIndex] : null;

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), [locale]);
  const summaryFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: orgCurrency, maximumFractionDigits: 0 }),
    [locale, orgCurrency],
  );

  const weekDateLabels = useMemo(
    () => weeks.map((week) => dateFormatter.format(new Date(`${week.weekStart}T00:00:00`))),
    [weeks, dateFormatter],
  );

  return (
    <div className="mt-6 rounded-[10px] border border-line bg-surface p-4 pb-5 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="font-disp text-base font-semibold text-ink">{t("heatmap.title")}</h2>
          <p className="num mt-0.5 text-[12px] text-ink-soft">
            {t("heatmap.summary", {
              count: summary.contractCount,
              amount: summaryFormatter.format(summary.totalAnnualCostOrgCurrency),
            })}
          </p>
        </div>
        <Tabs value={String(rangeDays)} onValueChange={(value) => setRangeDays(Number(value))}>
          <SegmentedControlList aria-label={t("heatmap.rangeLabel")}>
            {RANGE_OPTIONS.map((days) => (
              <SegmentedControlItem key={days} value={String(days)}>
                {t("heatmap.rangeOption", { days })}
              </SegmentedControlItem>
            ))}
          </SegmentedControlList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div
            role="group"
            aria-label={t("heatmap.gridLabel")}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
          >
            {weeks.map((week, index) => (
              <HeatmapCell
                key={week.index}
                week={week}
                active={activeWeekIndex === week.index}
                dateLabel={weekDateLabels[index]}
                onSelect={setSelectedWeekIndex}
                t={t}
              />
            ))}
          </div>

          {/* Alternativa lineal para lectores de pantalla: el grid de botones
              de arriba ya es navegable por teclado por sí mismo (no lleva
              aria-hidden, cada celda es el control primario), pero esta
              lista añade un atajo directo a cada contrato sin tener que
              entrar celda por celda — mismo patrón que renewals-calendar.tsx. */}
          <div className="sr-only">
            <h3>{t("heatmap.srTitle")}</h3>
            {weeks.every((week) => week.tickets.length === 0) ? (
              <p>{t("heatmap.srEmpty")}</p>
            ) : (
              <ul>
                {weeks.flatMap((week, index) =>
                  week.tickets.map((ticket) => (
                    <li key={ticket.contractId}>
                      <a href={buildContractPath(locale, ticket.vendorId, ticket.contractId)}>
                        {/* Mismo criterio de 3 casos que HeatmapTicketRow (panel):
                            vencido -> daysUntil bruto; preaviso activo (sin estar
                            vencido) -> daysUntil bruto + preaviso; caso general ->
                            actionableDaysUntil. Evita mostrar cifras negativas sin
                            sentido para contratos con preaviso ya descontado. */}
                        {ticket.daysUntil < 0
                          ? t("heatmap.srOverdue", {
                              vendor: ticket.vendorName,
                              date: weekDateLabels[index],
                              days: Math.abs(ticket.daysUntil),
                            })
                          : ticket.noticeWarning
                            ? t("heatmap.srNoticeWarning", {
                                vendor: ticket.vendorName,
                                date: weekDateLabels[index],
                                days: ticket.daysUntil,
                                noticeDays: ticket.cancellationNoticeDays,
                              })
                            : t("heatmap.srDaysRemaining", {
                                vendor: ticket.vendorName,
                                date: weekDateLabels[index],
                                days: ticket.actionableDaysUntil,
                              })}
                      </a>
                    </li>
                  )),
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          <RenewalHeatmapPanel week={activeWeek} locale={locale} orgCurrency={orgCurrency} />
        </div>
      </div>
    </div>
  );
}
