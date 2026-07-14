import { getTranslations } from "next-intl/server";
import type { DepartmentSpendRow } from "@/features/dashboard/types";

export async function DepartmentSpendTable({
  rows,
  locale,
  orgCurrency,
}: {
  rows: DepartmentSpendRow[];
  locale: string;
  orgCurrency: string;
}) {
  const t = await getTranslations("Shell.dashboard.departmentSpend");
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: orgCurrency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-disp text-base font-semibold text-ink">{t("title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-line px-2.5 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                  {t("table.department")}
                </th>
                <th className="border-b border-line px-2.5 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                  {t("table.annualized")}
                </th>
                <th className="border-b border-line px-2.5 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                  {t("table.vendors")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.departmentId ?? "unassigned"}>
                  <td className="border-b border-line px-2.5 py-2.5 text-sm text-ink last:border-b-0">
                    {row.departmentName}
                  </td>
                  <td className="num border-b border-line px-2.5 py-2.5 text-sm text-ink last:border-b-0">
                    {currencyFormatter.format(row.annualizedSpend)}
                  </td>
                  <td className="num border-b border-line px-2.5 py-2.5 text-sm text-ink last:border-b-0">
                    {row.vendorCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
