"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import type { SpendGroupRow } from "@/features/dashboard/types";

const BAR_HEIGHT = 10;

function GroupBars({
  rows,
  title,
  emptyLabel,
  columnLabels,
  amountFormatter,
}: {
  rows: SpendGroupRow[];
  title: string;
  emptyLabel: string;
  columnLabels: { name: string; annualized: string; vendors: string };
  amountFormatter: Intl.NumberFormat;
}) {
  const maxSpend = rows.length > 0 ? rows[0].annualizedSpend : 0;

  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">{emptyLabel}</p>;
  }

  return (
    <div>
      {/* Chart visual: decorativo, los datos reales viven en la tabla sr-only
          de abajo — un lector de pantalla no pierde nada al no "ver" barras. */}
      <div className="flex flex-col gap-3" aria-hidden="true">
        {rows.map((row, index) => {
          const pct = maxSpend > 0 ? Math.max((row.annualizedSpend / maxSpend) * 100, 2) : 0;
          return (
            <div key={row.groupId ?? "unassigned"} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-sm text-ink sm:w-32" title={row.groupName}>
                {row.groupName}
              </span>
              <div className="flex-1">
                <div
                  className="rounded-[4px]"
                  style={{
                    height: BAR_HEIGHT,
                    width: `${pct}%`,
                    backgroundColor: index === 0 ? "var(--lime)" : "var(--barfill)",
                  }}
                />
              </div>
              <span className="num w-20 shrink-0 text-right text-sm text-ink">
                {amountFormatter.format(row.annualizedSpend)}
              </span>
              <span className="num w-6 shrink-0 text-right text-xs text-ink-soft">{row.vendorCount}</span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>{columnLabels.name}</th>
            <th>{columnLabels.annualized}</th>
            <th>{columnLabels.vendors}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.groupId ?? "unassigned"}>
              <td>{row.groupName}</td>
              <td>{amountFormatter.format(row.annualizedSpend)}</td>
              <td>{row.vendorCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpendByGroupChart({
  departmentRows,
  companyRows,
  locale,
  orgCurrency,
}: {
  departmentRows: SpendGroupRow[];
  companyRows: SpendGroupRow[];
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard");
  const [activeTab, setActiveTab] = useState("department");
  const amountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: orgCurrency,
        maximumFractionDigits: 0,
      }),
    [locale, orgCurrency],
  );

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="font-disp text-base font-semibold text-ink">
            {activeTab === "company" ? t("companySpend.title") : t("departmentSpend.title")}
          </h2>
          <TabsList className="border-b-0 gap-1">
            <TabsTrigger
              value="department"
              className="rounded-btn border border-line px-3 py-1 text-xs data-[active]:border-ink data-[active]:bg-ink data-[active]:text-lime-ink"
            >
              {t("spendByGroup.toggle.department")}
            </TabsTrigger>
            <TabsTrigger
              value="company"
              className="rounded-btn border border-line px-3 py-1 text-xs data-[active]:border-ink data-[active]:bg-ink data-[active]:text-lime-ink"
            >
              {t("spendByGroup.toggle.company")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsPanel value="department">
          <GroupBars
            rows={departmentRows}
            title={t("departmentSpend.title")}
            emptyLabel={t("departmentSpend.empty")}
            columnLabels={{
              name: t("departmentSpend.table.department"),
              annualized: t("departmentSpend.table.annualized"),
              vendors: t("departmentSpend.table.vendors"),
            }}
            amountFormatter={amountFormatter}
          />
        </TabsPanel>
        <TabsPanel value="company">
          <GroupBars
            rows={companyRows}
            title={t("companySpend.title")}
            emptyLabel={t("companySpend.empty")}
            columnLabels={{
              name: t("companySpend.table.company"),
              annualized: t("companySpend.table.annualized"),
              vendors: t("companySpend.table.vendors"),
            }}
            amountFormatter={amountFormatter}
          />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
