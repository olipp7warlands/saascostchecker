"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControlItem, SegmentedControlList } from "@/components/ui/segmented-control";
import { Tabs } from "@/components/ui/tabs";
import {
  buildRenewalHeatmapGrid,
  buildRenewalHeatmapMonths,
  buildRenewalHeatmapWeeks,
  buildRenewalHeatmapYears,
  firstRenewalHeatmapCellWithTickets,
  selectRenewalTickets,
  shiftRenewalHeatmapWindow,
  summarizeRenewalTickets,
} from "@/features/dashboard/aggregate";
import {
  HEATMAP_CELL_CLASSES,
  HEATMAP_EMPTY_CELL_CLASSES,
  HEATMAP_PADDING_CELL_CLASSES,
} from "@/features/dashboard/renewal-heatmap-classes";
import type {
  RenewalHeatmapDay,
  RenewalHeatmapGranularity,
  RenewalHeatmapGrid,
  RenewalHeatmapSelection,
  RenewalTicket,
} from "@/features/dashboard/types";
import type { RenewalTone } from "@/features/vendors/renewal";
import { cn } from "@/lib/utils";
import { HeatmapSrList } from "./renewal-heatmap-sr-list";
import { RenewalHeatmapPanel } from "./renewal-heatmap-panel";
import { RenewalHeatmapStrip, type RenewalHeatmapStripCell } from "./renewal-heatmap-strip";

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

function parseLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

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

// Vista de nivel Día: el grid estilo GitHub (v3.1), sin cambios de lógica —
// solo pasa a recibir una ventana de 13 semanas navegable (`grid`, ya
// construida por el contenedor) en vez de un horizonte fijo de 12 meses.
function RenewalHeatmapDayGrid({
  grid,
  selection,
  onSelectDay,
  onSelectMonth,
  srTitle,
  srEmpty,
  locale,
  t,
}: {
  grid: RenewalHeatmapGrid;
  selection: RenewalHeatmapSelection | null;
  onSelectDay: (date: string) => void;
  onSelectMonth: (year: number, month: number) => void;
  srTitle: string;
  srEmpty: string;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const cellDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }),
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

  const gridWidthPx = grid.weekCount * (CELL_PX + GAP_PX) - GAP_PX;

  const srItems = grid.days
    .filter((day) => !day.isPadding)
    .flatMap((day) =>
      day.tickets.map((ticket) => ({
        ticket,
        dateLabel: cellDateFormatter.format(parseLocalDate(day.date)),
      })),
    );

  return (
    <div>
      {/* Scroll horizontal CONTENIDO al componente, nunca de página — en
          desktop las ~13 columnas caben sin necesitarlo. */}
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-1.5" style={{ width: "max-content" }}>
          <div className="flex flex-col gap-[3px] pt-[18px]" style={{ width: 22 }}>
            {Array.from({ length: 7 }, (_, row) => (
              <div
                key={row}
                className="flex items-center text-[9px] text-ink-soft capitalize"
                style={{ height: CELL_PX }}
              >
                {WEEKDAY_LABEL_ROWS.includes(row) ? weekdayFormatter.format(new Date(2023, 0, 2 + row)) : ""}
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
                  selection !== null &&
                  selection.kind === "month" &&
                  selection.year === label.year &&
                  selection.month === label.month;
                const monthDate = new Date(label.year, label.month, 1);
                return (
                  <button
                    key={`${label.year}-${label.month}`}
                    type="button"
                    onClick={() => onSelectMonth(label.year, label.month)}
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
                    active={selection !== null && selection.kind === "day" && selection.date === day.date}
                    dateLabel={cellDateFormatter.format(parseLocalDate(day.date))}
                    onSelect={() => onSelectDay(day.date)}
                    t={t}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      <HeatmapSrList title={srTitle} emptyText={srEmpty} items={srItems} locale={locale} t={t} />
    </div>
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
  const [granularity, setGranularityState] = useState<RenewalHeatmapGranularity>("day");
  const [windowStart, setWindowStart] = useState(() => today);
  // Selección explícita del usuario (clic en una celda). Navegar (flechas,
  // "Hoy", cambiar de nivel) la resetea a null — la selección por defecto se
  // recalcula entonces sobre la nueva ventana (primera celda con contenido).
  const [explicitSelection, setExplicitSelection] = useState<RenewalHeatmapSelection | null>(null);

  function changeGranularity(next: RenewalHeatmapGranularity) {
    setGranularityState(next);
    setWindowStart(today);
    setExplicitSelection(null);
  }
  function goPrev() {
    setWindowStart((prev) => shiftRenewalHeatmapWindow(granularity, prev, -1));
    setExplicitSelection(null);
  }
  function goNext() {
    setWindowStart((prev) => shiftRenewalHeatmapWindow(granularity, prev, 1));
    setExplicitSelection(null);
  }
  function goToday() {
    setWindowStart(today);
    setExplicitSelection(null);
  }

  const view = useMemo(() => {
    switch (granularity) {
      case "day":
        return { granularity: "day" as const, grid: buildRenewalHeatmapGrid(tickets, windowStart, today) };
      case "week":
        return { granularity: "week" as const, weeks: buildRenewalHeatmapWeeks(tickets, windowStart, today) };
      case "month":
        return { granularity: "month" as const, months: buildRenewalHeatmapMonths(tickets, windowStart, today) };
      case "year":
        return { granularity: "year" as const, years: buildRenewalHeatmapYears(tickets, today) };
    }
  }, [granularity, tickets, windowStart, today]);

  const windowTickets = useMemo(() => {
    switch (view.granularity) {
      case "day":
        return view.grid.days.flatMap((day) => day.tickets);
      case "week":
        return view.weeks.flatMap((week) => week.tickets);
      case "month":
        return view.months.flatMap((month) => month.tickets);
      case "year":
        return view.years.flatMap((year) => year.tickets);
    }
  }, [view]);

  const defaultSelection = useMemo<RenewalHeatmapSelection | null>(() => {
    switch (view.granularity) {
      case "day": {
        const cell = firstRenewalHeatmapCellWithTickets(view.grid.days);
        return cell ? { kind: "day", date: cell.date } : null;
      }
      case "week": {
        const cell = firstRenewalHeatmapCellWithTickets(view.weeks);
        return cell ? { kind: "week", weekStart: cell.weekStart } : null;
      }
      case "month": {
        const cell = firstRenewalHeatmapCellWithTickets(view.months);
        return cell ? { kind: "month", year: cell.year, month: cell.month } : null;
      }
      case "year": {
        const cell = firstRenewalHeatmapCellWithTickets(view.years);
        return cell ? { kind: "year", year: cell.year } : null;
      }
    }
  }, [view]);

  const selection = explicitSelection ?? defaultSelection;
  const summary = useMemo(() => summarizeRenewalTickets(windowTickets), [windowTickets]);
  const selectedTickets = useMemo(
    () => (selection ? selectRenewalTickets(tickets, selection, today) : []),
    [tickets, selection, today],
  );

  const rangeMonthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short" }), [locale]);
  const rangeMonthYearFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );
  const monthAriaFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const weekStartFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
    [locale],
  );
  const weekEndFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    [locale],
  );
  const summaryFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: orgCurrency, maximumFractionDigits: 0 }),
    [locale, orgCurrency],
  );

  function formatDateRange(start: Date, end: Date): string {
    if (start.getFullYear() === end.getFullYear()) {
      return `${rangeMonthFormatter.format(start)} – ${rangeMonthFormatter.format(end)} ${end.getFullYear()}`;
    }
    return `${rangeMonthYearFormatter.format(start)} – ${rangeMonthYearFormatter.format(end)}`;
  }

  // Cabecera de la ventana visible (p.ej. "Ago – Oct 2026") — cálculo barato
  // sobre arrays ya memoizados en `view`, sin necesidad de su propio useMemo.
  let windowRangeLabel = "";
  switch (view.granularity) {
    case "day": {
      const realDays = view.grid.days.filter((day) => !day.isPadding);
      if (realDays.length > 0) {
        windowRangeLabel = formatDateRange(
          parseLocalDate(realDays[0].date),
          parseLocalDate(realDays[realDays.length - 1].date),
        );
      }
      break;
    }
    case "week": {
      if (view.weeks.length > 0) {
        windowRangeLabel = formatDateRange(
          parseLocalDate(view.weeks[0].weekStart),
          parseLocalDate(view.weeks[view.weeks.length - 1].weekEnd),
        );
      }
      break;
    }
    case "month": {
      if (view.months.length > 0) {
        const first = view.months[0];
        const last = view.months[view.months.length - 1];
        windowRangeLabel = formatDateRange(new Date(first.year, first.month, 1), new Date(last.year, last.month, 1));
      }
      break;
    }
    case "year": {
      if (view.years.length > 0) {
        const first = view.years[0].year;
        const last = view.years[view.years.length - 1].year;
        windowRangeLabel = first === last ? String(first) : `${first} – ${last}`;
      }
      break;
    }
  }

  return (
    <div className="mt-6 rounded-[10px] border border-line bg-surface p-4 pb-5 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-disp text-base font-semibold text-ink">{t("heatmap.title")}</h2>
          <p className="num mt-0.5 text-[12px] text-ink-soft">
            {t("heatmap.summary", {
              count: summary.contractCount,
              amount: summaryFormatter.format(summary.totalAnnualCostOrgCurrency),
              range: windowRangeLabel,
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={granularity} onValueChange={(value) => changeGranularity(value as RenewalHeatmapGranularity)}>
            <SegmentedControlList>
              <SegmentedControlItem value="day">{t("heatmap.granularityDay")}</SegmentedControlItem>
              <SegmentedControlItem value="week">{t("heatmap.granularityWeek")}</SegmentedControlItem>
              <SegmentedControlItem value="month">{t("heatmap.granularityMonth")}</SegmentedControlItem>
              <SegmentedControlItem value="year">{t("heatmap.granularityYear")}</SegmentedControlItem>
            </SegmentedControlList>
          </Tabs>

          {granularity !== "year" && (
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon-sm" onClick={goPrev} aria-label={t("heatmap.navPrev")}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={goToday}>
                {t("heatmap.navToday")}
              </Button>
              <Button type="button" variant="outline" size="icon-sm" onClick={goNext} aria-label={t("heatmap.navNext")}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {view.granularity === "day" && (
            <RenewalHeatmapDayGrid
              grid={view.grid}
              selection={selection}
              onSelectDay={(date) => setExplicitSelection({ kind: "day", date })}
              onSelectMonth={(year, month) => setExplicitSelection({ kind: "month", year, month })}
              srTitle={t("heatmap.srTitle", { range: windowRangeLabel })}
              srEmpty={t("heatmap.srEmpty", { range: windowRangeLabel })}
              locale={locale}
              t={t}
            />
          )}

          {view.granularity === "week" && (
            <RenewalHeatmapStrip
              groupLabel={t("heatmap.stripLabel")}
              srTitle={t("heatmap.srTitle", { range: windowRangeLabel })}
              srEmpty={t("heatmap.srEmpty", { range: windowRangeLabel })}
              locale={locale}
              t={t}
              cells={view.weeks.map((week): RenewalHeatmapStripCell => {
                const label = `${weekStartFormatter.format(parseLocalDate(week.weekStart))} – ${weekEndFormatter.format(parseLocalDate(week.weekEnd))}`;
                const count = week.tickets.length;
                return {
                  key: week.weekStart,
                  active:
                    selection !== null && selection.kind === "week" && selection.weekStart === week.weekStart,
                  onSelect: () => setExplicitSelection({ kind: "week", weekStart: week.weekStart }),
                  ariaLabel: t("heatmap.cellAriaLabel", {
                    date: label,
                    tone: t(`stackStatus.${TONE_TO_STACK_STATUS_KEY[week.tone]}`),
                    count,
                  }),
                  tooltip: t("heatmap.cellTooltip", { date: label, count }),
                  tone: week.tone,
                  intensity: week.intensity,
                };
              })}
              srItems={view.weeks.flatMap((week) => {
                const label = `${weekStartFormatter.format(parseLocalDate(week.weekStart))} – ${weekEndFormatter.format(parseLocalDate(week.weekEnd))}`;
                return week.tickets.map((ticket) => ({ ticket, dateLabel: label }));
              })}
            />
          )}

          {view.granularity === "month" && (
            <RenewalHeatmapStrip
              groupLabel={t("heatmap.stripLabel")}
              srTitle={t("heatmap.srTitle", { range: windowRangeLabel })}
              srEmpty={t("heatmap.srEmpty", { range: windowRangeLabel })}
              locale={locale}
              t={t}
              cells={view.months.map((month): RenewalHeatmapStripCell => {
                const label = monthAriaFormatter.format(new Date(month.year, month.month, 1));
                const count = month.tickets.length;
                return {
                  key: `${month.year}-${month.month}`,
                  active:
                    selection !== null &&
                    selection.kind === "month" &&
                    selection.year === month.year &&
                    selection.month === month.month,
                  onSelect: () => setExplicitSelection({ kind: "month", year: month.year, month: month.month }),
                  ariaLabel: t("heatmap.cellAriaLabel", {
                    date: label,
                    tone: t(`stackStatus.${TONE_TO_STACK_STATUS_KEY[month.tone]}`),
                    count,
                  }),
                  tooltip: t("heatmap.cellTooltip", { date: label, count }),
                  tone: month.tone,
                  intensity: month.intensity,
                };
              })}
              srItems={view.months.flatMap((month) => {
                const label = monthAriaFormatter.format(new Date(month.year, month.month, 1));
                return month.tickets.map((ticket) => ({ ticket, dateLabel: label }));
              })}
            />
          )}

          {view.granularity === "year" && (
            <RenewalHeatmapStrip
              groupLabel={t("heatmap.stripLabel")}
              srTitle={t("heatmap.srTitle", { range: windowRangeLabel })}
              srEmpty={t("heatmap.srEmpty", { range: windowRangeLabel })}
              locale={locale}
              t={t}
              cells={view.years.map((year): RenewalHeatmapStripCell => {
                const label = String(year.year);
                const count = year.tickets.length;
                return {
                  key: label,
                  active: selection !== null && selection.kind === "year" && selection.year === year.year,
                  onSelect: () => setExplicitSelection({ kind: "year", year: year.year }),
                  ariaLabel: t("heatmap.cellAriaLabel", {
                    date: label,
                    tone: t(`stackStatus.${TONE_TO_STACK_STATUS_KEY[year.tone]}`),
                    count,
                  }),
                  tooltip: t("heatmap.cellTooltip", { date: label, count }),
                  tone: year.tone,
                  intensity: year.intensity,
                };
              })}
              srItems={view.years.flatMap((year) => year.tickets.map((ticket) => ({ ticket, dateLabel: String(year.year) })))}
            />
          )}
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          <RenewalHeatmapPanel
            tickets={selectedTickets}
            selection={selection}
            locale={locale}
            orgCurrency={orgCurrency}
          />
        </div>
      </div>
    </div>
  );
}
