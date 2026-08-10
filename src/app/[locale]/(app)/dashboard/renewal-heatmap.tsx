"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildRenewalHeatmapGrid,
  selectRenewalTickets,
  summarizeRenewalTickets,
} from "@/features/dashboard/aggregate";
import {
  HEATMAP_CELL_CLASSES,
  HEATMAP_EMPTY_CELL_CLASSES,
  HEATMAP_PADDING_CELL_CLASSES,
} from "@/features/dashboard/renewal-heatmap-classes";
import type { RenewalHeatmapDay, RenewalHeatmapSelection, RenewalTicket } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";
import type { RenewalTone } from "@/features/vendors/renewal";
import { cn } from "@/lib/utils";
import { RenewalHeatmapPanel } from "./renewal-heatmap-panel";

const CELL_PX = 11;
const GAP_PX = 3;
const WEEKDAY_LABEL_ROWS = [0, 2, 4]; // Lun/Mié/Vie — fila 0-indexada, lunes arriba.

// Reutiliza literalmente el vocabulario ya existente de Shell.dashboard.stackStatus
// (Crítico/Próximo/Estable) para el aria-label de la celda — cero vocabulario nuevo.
const TONE_TO_STACK_STATUS_KEY: Record<RenewalTone, "critical" | "upcoming" | "stable"> = {
  red: "critical",
  amber: "upcoming",
  neutral: "stable",
};

function HeatmapDayCell({
  day,
  active,
  dateLabel,
  onSelect,
  t,
}: {
  day: RenewalHeatmapDay;
  active: boolean;
  dateLabel: string;
  onSelect: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const count = day.tickets.length;
  const toneLabel = t(`stackStatus.${TONE_TO_STACK_STATUS_KEY[day.tone]}`);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={t("heatmap.cellAriaLabel", { date: dateLabel, tone: toneLabel, count })}
      title={t("heatmap.cellTooltip", { date: dateLabel, count })}
      className={cn(
        "rounded-[2px] border outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        count === 0 ? HEATMAP_EMPTY_CELL_CLASSES : HEATMAP_CELL_CLASSES[day.tone][day.intensity!],
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
  // Snapshot estable de "hoy" para todo el ciclo de vida del componente,
  // mismo patrón que renewals-calendar.tsx — evita que el bucketing cambie
  // de día a mitad de sesión si el usuario deja la pestaña abierta.
  const [today] = useState(() => new Date());
  const [selection, setSelection] = useState<RenewalHeatmapSelection>(() => ({
    kind: "month",
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const grid = useMemo(() => buildRenewalHeatmapGrid(tickets, today), [tickets, today]);
  const summary = useMemo(() => summarizeRenewalTickets(tickets), [tickets]);
  const selectedTickets = useMemo(
    () => selectRenewalTickets(tickets, selection, today),
    [tickets, selection, today],
  );

  const cellDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }),
    [locale],
  );
  const monthLabelFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short" }), [locale]);
  const monthLabelWithYearFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }),
    [locale],
  );
  const monthAriaFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const summaryFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: orgCurrency, maximumFractionDigits: 0 }),
    [locale, orgCurrency],
  );

  const gridWidthPx = grid.weekCount * (CELL_PX + GAP_PX) - GAP_PX;

  return (
    <div className="mt-6 rounded-[10px] border border-line bg-surface p-4 pb-5 sm:p-5">
      <div className="mb-4">
        <h2 className="font-disp text-base font-semibold text-ink">{t("heatmap.title")}</h2>
        <p className="num mt-0.5 text-[12px] text-ink-soft">
          {t("heatmap.summary", {
            count: summary.contractCount,
            amount: summaryFormatter.format(summary.totalAnnualCostOrgCurrency),
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {/* Scroll horizontal CONTENIDO al componente, nunca de página —
              en desktop las ~52 columnas caben sin necesitarlo. */}
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-1.5" style={{ width: "max-content" }}>
              <div className="flex flex-col gap-[3px] pt-[18px]" style={{ width: 22 }}>
                {Array.from({ length: 7 }, (_, row) => (
                  <div
                    key={row}
                    className="flex items-center text-[9px] text-ink-soft capitalize"
                    style={{ height: CELL_PX }}
                  >
                    {WEEKDAY_LABEL_ROWS.includes(row)
                      ? weekdayFormatter.format(new Date(2023, 0, 2 + row))
                      : ""}
                  </div>
                ))}
              </div>

              <div>
                <div
                  role="group"
                  aria-label={t("heatmap.monthRowLabel")}
                  className="relative mb-[3px]"
                  style={{ height: 14, width: gridWidthPx }}
                >
                  {grid.monthLabels.map((label) => {
                    const active =
                      selection.kind === "month" && selection.year === label.year && selection.month === label.month;
                    const monthDate = new Date(label.year, label.month, 1);
                    return (
                      <button
                        key={`${label.year}-${label.month}`}
                        type="button"
                        onClick={() => setSelection({ kind: "month", year: label.year, month: label.month })}
                        aria-pressed={active}
                        aria-label={t("heatmap.monthAriaLabel", { month: monthAriaFormatter.format(monthDate) })}
                        className={cn(
                          "absolute top-0 rounded-[4px] px-0.5 text-[10px] font-medium capitalize whitespace-nowrap outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50",
                          active ? "font-semibold text-ink" : "text-ink-soft",
                        )}
                        style={{ left: label.columnIndex * (CELL_PX + GAP_PX) }}
                      >
                        {(label.showYear ? monthLabelWithYearFormatter : monthLabelFormatter).format(monthDate)}
                      </button>
                    );
                  })}
                </div>

                <div
                  role="group"
                  aria-label={t("heatmap.gridLabel")}
                  className="grid"
                  style={{
                    gridAutoFlow: "column",
                    gridTemplateRows: `repeat(7, ${CELL_PX}px)`,
                    gridAutoColumns: `${CELL_PX}px`,
                    gap: `${GAP_PX}px`,
                  }}
                >
                  {grid.days.map((day) =>
                    day.isPadding ? (
                      <div key={day.date} aria-hidden className={HEATMAP_PADDING_CELL_CLASSES} />
                    ) : (
                      <HeatmapDayCell
                        key={day.date}
                        day={day}
                        active={selection.kind === "day" && selection.date === day.date}
                        dateLabel={cellDateFormatter.format(new Date(`${day.date}T00:00:00`))}
                        onSelect={() => setSelection({ kind: "day", date: day.date })}
                        t={t}
                      />
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Alternativa lineal para lectores de pantalla: el grid de arriba
              ya es navegable por teclado por sí mismo (no lleva aria-hidden,
              cada celda es el control primario), pero esta lista añade un
              atajo directo a cada contrato sin tener que recorrer el grid
              día a día — mismo patrón que renewals-calendar.tsx. */}
          <div className="sr-only">
            <h3>{t("heatmap.srTitle")}</h3>
            {grid.days.every((day) => day.tickets.length === 0) ? (
              <p>{t("heatmap.srEmpty")}</p>
            ) : (
              <ul>
                {grid.days
                  .filter((day) => !day.isPadding)
                  .flatMap((day) => {
                    const dateLabel = cellDateFormatter.format(new Date(`${day.date}T00:00:00`));
                    return day.tickets.map((ticket) => (
                      <li key={ticket.contractId}>
                        <a href={buildContractPath(locale, ticket.vendorId, ticket.contractId)}>
                          {/* Mismo criterio de 3 casos que HeatmapTicketRow (panel):
                              vencido -> daysUntil bruto; preaviso activo (sin estar
                              vencido) -> daysUntil bruto + preaviso; caso general ->
                              actionableDaysUntil. */}
                          {ticket.daysUntil < 0
                            ? t("heatmap.srOverdue", {
                                vendor: ticket.vendorName,
                                date: dateLabel,
                                days: Math.abs(ticket.daysUntil),
                              })
                            : ticket.noticeWarning
                              ? t("heatmap.srNoticeWarning", {
                                  vendor: ticket.vendorName,
                                  date: dateLabel,
                                  days: ticket.daysUntil,
                                  noticeDays: ticket.cancellationNoticeDays,
                                })
                              : t("heatmap.srDaysRemaining", {
                                  vendor: ticket.vendorName,
                                  date: dateLabel,
                                  days: ticket.actionableDaysUntil,
                                })}
                        </a>
                      </li>
                    ));
                  })}
              </ul>
            )}
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          <RenewalHeatmapPanel tickets={selectedTickets} selection={selection} locale={locale} orgCurrency={orgCurrency} />
        </div>
      </div>
    </div>
  );
}
