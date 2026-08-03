"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppLogo } from "@/components/catalog/app-logo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControlItem, SegmentedControlList } from "@/components/ui/segmented-control";
import { Tabs } from "@/components/ui/tabs";
import type { DashboardContract } from "@/features/dashboard/types";
import { buildCalendarMonth, type CalendarDay, type CalendarMarker } from "@/features/renewals/calendar";
import { buildContractPath } from "@/features/renewals/deep-link";
import { daysUntil } from "@/features/vendors/renewal";
import { TONE_CLASSES } from "@/features/vendors/renewal-tone-classes";
import { cn } from "@/lib/utils";
import { MonthPicker } from "./month-picker";
import { YearView } from "./year-view";

const MAX_VISIBLE_MARKERS = 3;
// Lunes de referencia — solo para derivar las etiquetas de cabecera de día
// de semana vía Intl, la fecha en sí es irrelevante.
const REFERENCE_MONDAY = new Date(2024, 0, 1);

type Option = { id: string; name: string };

function MarkerChip({
  marker,
  locale,
}: {
  marker: CalendarMarker;
  locale: string;
}) {
  const compactCost = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: marker.currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(marker.annualCost),
    [locale, marker.currency, marker.annualCost],
  );

  return (
    <a
      href={buildContractPath(locale, marker.vendorId, marker.contractId)}
      aria-label={marker.vendorName}
      title={`${marker.vendorName} · ${compactCost}`}
      className={cn(
        "flex items-center gap-1 overflow-hidden rounded-[4px] border px-1 py-0.5 text-[10.5px] font-medium text-ink",
        marker.kind === "actionable" ? TONE_CLASSES[marker.tone] : "border-line bg-surface text-ink-soft",
      )}
    >
      <AppLogo domain={marker.vendorWebsite || null} name={marker.vendorName} size={14} className="shrink-0 rounded-[3px]" />
      <span className="min-w-0 flex-1 truncate">{marker.vendorName}</span>
      <span className="num shrink-0 text-[9.5px] opacity-80">{compactCost}</span>
    </a>
  );
}

export function RenewalsCalendar({
  contracts,
  companies,
  departments,
  locale,
}: {
  contracts: DashboardContract[];
  companies: Option[];
  departments: Option[];
  locale: string;
}) {
  const t = useTranslations("Renewals");
  const [today] = useState(() => new Date());
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [hideNoAutoRenew, setHideNoAutoRenew] = useState(false);

  const filteredContracts = useMemo(
    () =>
      contracts.filter(
        (contract) =>
          (companyId === "" || contract.companyId === companyId) &&
          (departmentId === "" || contract.departmentId === departmentId) &&
          (!hideNoAutoRenew || contract.autoRenews),
      ),
    [contracts, companyId, departmentId, hideNoAutoRenew],
  );

  const days = useMemo(
    () => buildCalendarMonth(filteredContracts, view.year, view.month, today),
    [filteredContracts, view, today],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
        new Date(view.year, view.month, 1),
      ),
    [locale, view],
  );

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(REFERENCE_MONDAY);
      date.setDate(date.getDate() + i);
      return formatter.format(date);
    });
  }, [locale]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), [locale]);

  function goToMonth(offset: number) {
    setView((prev) => {
      const next = new Date(prev.year, prev.month + offset, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function goToToday() {
    setView({ year: today.getFullYear(), month: today.getMonth() });
    setViewMode("month");
  }

  // Usado tanto por el picker de mes/año como por clicar un mini-mes en la
  // vista anual — siempre vuelve a vista mensual del mes elegido.
  function goToMonthYear(year: number, month: number) {
    setView({ year, month });
    setViewMode("month");
  }

  const agendaEntries = days
    .filter((day) => day.isCurrentMonth && day.markers.length > 0)
    .flatMap((day) => day.markers.map((marker) => ({ day, marker })));

  const hasAnyMarkers = days.some((day) => day.markers.length > 0);

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => goToMonth(-1)}
            aria-label={t("nav.prevMonth")}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <MonthPicker
            year={view.year}
            month={view.month}
            monthLabel={monthLabel}
            locale={locale}
            pickMonthLabel={t("nav.pickMonth")}
            prevYearLabel={t("nav.prevYear")}
            nextYearLabel={t("nav.nextYear")}
            onSelect={goToMonthYear}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => goToMonth(1)}
            aria-label={t("nav.nextMonth")}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={goToToday}>
            {t("nav.today")}
          </Button>
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value === "year" ? "year" : "month")}>
            <SegmentedControlList>
              <SegmentedControlItem value="month">{t("nav.viewMonth")}</SegmentedControlItem>
              <SegmentedControlItem value="year">{t("nav.viewYear")}</SegmentedControlItem>
            </SegmentedControlList>
          </Tabs>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40">
            <Select value={companyId} onValueChange={(next) => setCompanyId(String(next))}>
              <SelectTrigger aria-label={t("filters.companyAll")}>
                <SelectValue>
                  {(current: string) =>
                    current === "" ? t("filters.companyAll") : (companies.find((c) => c.id === current)?.name ?? current)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("filters.companyAll")}</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={departmentId} onValueChange={(next) => setDepartmentId(String(next))}>
              <SelectTrigger aria-label={t("filters.departmentAll")}>
                <SelectValue>
                  {(current: string) =>
                    current === ""
                      ? t("filters.departmentAll")
                      : (departments.find((d) => d.id === current)?.name ?? current)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("filters.departmentAll")}</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="hideNoAutoRenew"
              type="checkbox"
              className="size-4"
              checked={hideNoAutoRenew}
              onChange={(event) => setHideNoAutoRenew(event.target.checked)}
            />
            <Label htmlFor="hideNoAutoRenew">{t("filters.hideNoAutoRenew")}</Label>
          </div>
        </div>
      </div>

      {viewMode === "month" ? (
        <>
          {!hasAnyMarkers && <p className="mt-4 text-sm text-ink-soft">{t("calendar.empty")}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse">
              <thead>
                <tr>
                  {weekdayLabels.map((label) => (
                    <th
                      key={label}
                      className="border-b border-line px-1.5 py-1.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: days.length / 7 }, (_, weekIndex) => (
                  <tr key={weekIndex}>
                    {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => (
                      <CalendarCell key={day.date} day={day} locale={locale} t={t} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sr-only">
            <h3>{t("agenda.title")}</h3>
            {agendaEntries.length === 0 ? (
              <p>{t("agenda.empty")}</p>
            ) : (
              <ul>
                {agendaEntries.map(({ day, marker }) => (
                  <li key={`${marker.contractId}-${marker.kind}`}>
                    <a href={buildContractPath(locale, marker.vendorId, marker.contractId)}>
                      {marker.kind === "informational"
                        ? t("marker.informational", { vendor: marker.vendorName, date: dateFormatter.format(new Date(`${day.date}T00:00:00`)) })
                        : (() => {
                            const remainingDays = daysUntil(day.date, today);
                            return remainingDays < 0
                              ? t("marker.overdue", { vendor: marker.vendorName, days: Math.abs(remainingDays) })
                              : t("marker.daysRemaining", { vendor: marker.vendorName, days: remainingDays });
                          })()}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <YearView
          year={view.year}
          contracts={filteredContracts}
          today={today}
          locale={locale}
          onSelectMonth={goToMonthYear}
        />
      )}
    </div>
  );
}

function CalendarCell({
  day,
  locale,
  t,
}: {
  day: CalendarDay;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const dayNumber = new Date(`${day.date}T00:00:00`).getDate();
  const visibleMarkers = day.markers.slice(0, MAX_VISIBLE_MARKERS);
  const hiddenCount = day.markers.length - visibleMarkers.length;

  return (
    <td
      className={cn(
        "h-24 w-[14.28%] border border-line p-1 align-top",
        !day.isCurrentMonth && "bg-muted/30",
      )}
    >
      <span className={cn("num text-[11px]", day.isCurrentMonth ? "text-ink-soft" : "text-ink-soft/50")}>
        {dayNumber}
      </span>
      <div className="mt-1 flex flex-col gap-0.5">
        {visibleMarkers.map((marker) => (
          <MarkerChip key={`${marker.contractId}-${marker.kind}`} marker={marker} locale={locale} />
        ))}
        {hiddenCount > 0 && (
          <span className="text-[10px] text-ink-soft">{t("calendar.moreCount", { count: hiddenCount })}</span>
        )}
      </div>
    </td>
  );
}
