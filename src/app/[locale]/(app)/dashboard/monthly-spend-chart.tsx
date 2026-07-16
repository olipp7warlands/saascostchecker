"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { MonthlySpendPoint } from "@/features/dashboard/types";

const WIDTH = 600;
const HEIGHT = 220;
const PADDING = { top: 16, right: 12, bottom: 24, left: 12 };
const GRIDLINES = 4;

function monthLabel(month: string, locale: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1, 1);
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
}

export function MonthlySpendChart({
  points,
  monthsWithData,
  locale,
  orgCurrency,
}: {
  points: MonthlySpendPoint[];
  monthsWithData: number;
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard.monthlySpend");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const amountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: orgCurrency,
        maximumFractionDigits: 0,
      }),
    [locale, orgCurrency],
  );
  const compactFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: orgCurrency,
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [locale, orgCurrency],
  );

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const maxAmount = Math.max(...points.map((p) => p.amount), 1);

  const coords = points.map((point, index) => {
    const x = PADDING.left + (index / Math.max(points.length - 1, 1)) * plotWidth;
    const y = PADDING.top + plotHeight - (point.amount / maxAmount) * plotHeight;
    return { ...point, x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1].x},${PADDING.top + plotHeight} L${coords[0].x},${PADDING.top + plotHeight} Z`
      : "";

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || coords.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDistance = Infinity;
    coords.forEach((c, i) => {
      const distance = Math.abs(c.x - relativeX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  if (monthsWithData < 2) {
    return (
      <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
        <h2 className="mb-3 font-disp text-base font-semibold text-ink">{t("title")}</h2>
        <p className="text-sm text-ink-soft">
          {t("empty")}{" "}
          <a href={`/${locale}/import`} className="text-ink underline">
            {t("emptyCta")}
          </a>
        </p>
      </div>
    );
  }

  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-disp text-base font-semibold text-ink">{t("title")}</h2>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full touch-none"
          aria-hidden="true"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {Array.from({ length: GRIDLINES + 1 }, (_, i) => {
            const y = PADDING.top + (i / GRIDLINES) * plotHeight;
            return (
              <line
                key={i}
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeWidth={1}
              />
            );
          })}

          {/* Wash semitransparente (spec del dataviz skill: ~10% opacidad, nunca
              un bloque sólido) — así no tapa los gridlines/labels dibujados
              antes ni después. */}
          <path d={areaPath} fill="var(--lime)" fillOpacity={0.12} stroke="none" />
          <path d={linePath} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Labels SIEMPRE por encima de gridlines/área/línea (nunca tapados). */}
          {Array.from({ length: GRIDLINES + 1 }, (_, i) => {
            const y = PADDING.top + (i / GRIDLINES) * plotHeight;
            const value = maxAmount * (1 - i / GRIDLINES);
            return (
              <text
                key={i}
                x={WIDTH - PADDING.right}
                y={y - 4}
                textAnchor="end"
                fontSize={9}
                fill="var(--ink-soft)"
              >
                {compactFormatter.format(value)}
              </text>
            );
          })}
          {coords.map((c, i) => (
            <text
              key={c.month}
              x={c.x}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? "start" : i === coords.length - 1 ? "end" : "middle"}
              fontSize={9}
              fill="var(--ink-soft)"
            >
              {monthLabel(c.month, locale)}
            </text>
          ))}

          {hovered && (
            <g>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PADDING.top}
                y2={PADDING.top + plotHeight}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-1 rounded-[7px] border border-line bg-bg px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(hovered.x / WIDTH) * 100}%`,
              transform: hovered.x > WIDTH * 0.7 ? "translateX(-100%)" : "translateX(-8px)",
            }}
          >
            <div className="font-semibold text-ink capitalize">{monthLabel(hovered.month, locale)}</div>
            <div className="num text-ink-soft">{amountFormatter.format(hovered.amount)}</div>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{t("title")}</caption>
        <thead>
          <tr>
            <th>{t("table.month")}</th>
            <th>{t("table.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <td>{point.month}</td>
              <td>{amountFormatter.format(point.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
