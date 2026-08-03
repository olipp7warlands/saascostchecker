"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { DashboardContract } from "@/features/dashboard/types";
import { buildCalendarMonth, worstTone } from "@/features/renewals/calendar";
import { TONE_TEXT_CLASSES } from "@/features/vendors/renewal-tone-classes";
import { cn } from "@/lib/utils";

function MiniMonth({
  year,
  month,
  contracts,
  today,
  locale,
  onSelect,
}: {
  year: number;
  month: number;
  contracts: DashboardContract[];
  today: Date;
  locale: string;
  onSelect: (year: number, month: number) => void;
}) {
  const t = useTranslations("Renewals");
  const days = useMemo(
    () => buildCalendarMonth(contracts, year, month, today),
    [contracts, year, month, today],
  );
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(year, month, 1)),
    [locale, year, month],
  );
  const markerCount = days
    .filter((day) => day.isCurrentMonth)
    .reduce((sum, day) => sum + day.markers.length, 0);

  return (
    <div className="rounded-[8px] border border-line bg-background p-2">
      <button
        type="button"
        onClick={() => onSelect(year, month)}
        className="w-full rounded-[4px] px-1 py-0.5 text-left text-[12.5px] font-semibold text-ink capitalize outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {monthLabel}
      </button>
      <div className="mt-1.5 grid grid-cols-7 gap-[3px]" aria-hidden="true">
        {days.map((day) => {
          const tone = day.isCurrentMonth ? worstTone(day.markers.map((marker) => marker.tone)) : null;
          return (
            <span key={day.date} className="flex size-[9px] items-center justify-center">
              {tone && <span className={cn("size-[5px] rounded-full bg-current", TONE_TEXT_CLASSES[tone])} />}
            </span>
          );
        })}
      </div>
      <span className="sr-only">{t("yearView.monthSummary", { month: monthLabel, count: markerCount })}</span>
    </div>
  );
}

export function YearView({
  year,
  contracts,
  today,
  locale,
  onSelectMonth,
}: {
  year: number;
  contracts: DashboardContract[];
  today: Date;
  locale: string;
  onSelectMonth: (year: number, month: number) => void;
}) {
  const t = useTranslations("Renewals");

  const hasAny = useMemo(() => {
    for (let month = 0; month < 12; month++) {
      const days = buildCalendarMonth(contracts, year, month, today);
      if (days.some((day) => day.isCurrentMonth && day.markers.length > 0)) return true;
    }
    return false;
  }, [contracts, year, today]);

  return (
    <div className="mt-4">
      {!hasAny && <p className="mb-3 text-sm text-ink-soft">{t("yearView.empty")}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            year={year}
            month={month}
            contracts={contracts}
            today={today}
            locale={locale}
            onSelect={onSelectMonth}
          />
        ))}
      </div>
    </div>
  );
}
