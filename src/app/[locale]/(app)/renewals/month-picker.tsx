"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REFERENCE_YEAR = 2024; // solo para derivar nombres de mes vía Intl, el año es irrelevante.

export function MonthPicker({
  year,
  month,
  monthLabel,
  locale,
  pickMonthLabel,
  prevYearLabel,
  nextYearLabel,
  onSelect,
}: {
  year: number;
  month: number;
  monthLabel: string;
  locale: string;
  pickMonthLabel: string;
  prevYearLabel: string;
  nextYearLabel: string;
  onSelect: (year: number, month: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);

  const monthNames = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(REFERENCE_YEAR, m, 1)),
  );

  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPickerYear(year); // reabre siempre centrado en el año visible actual
      }}
    >
      <h2 className="num min-w-[9rem] text-center font-disp text-base font-semibold text-ink capitalize sm:text-left">
        <Menu.Trigger
          aria-label={pickMonthLabel}
          className="rounded-[6px] px-1.5 py-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {monthLabel}
        </Menu.Trigger>
      </h2>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="center" sideOffset={4} className="z-50 outline-none">
          <Menu.Popup className="w-[260px] rounded-lg border border-line bg-surface p-3 shadow-lg outline-none">
            <div className="mb-2.5 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setPickerYear((y) => y - 1)}
                aria-label={prevYearLabel}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <span className="num text-sm font-semibold text-ink">{pickerYear}</span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setPickerYear((y) => y + 1)}
                aria-label={nextYearLabel}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {monthNames.map((name, m) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onSelect(pickerYear, m);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-[6px] px-2 py-1.5 text-[12.5px] font-medium text-ink capitalize outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                    pickerYear === year && m === month && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
