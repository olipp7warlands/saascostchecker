import { convertAmount } from "./currency";
import type { ExchangeRate, MonthlySpendPoint, MonthlySpendRow, MonthlySpendSeries } from "./types";

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

// Construye la serie de gasto mensual de los últimos `monthsCount` meses
// (incluido el mes en curso), convertida a `orgCurrency`. La RPC
// dashboard_monthly_spend() solo devuelve filas para meses con algún
// spend_record reconciliado — un mes sin gasto real no debe desaparecer del
// eje, se rellena a 0 aquí para que el chart muestre los 12 meses siempre.
export function buildMonthlySpendSeries(
  rows: MonthlySpendRow[],
  orgCurrency: string,
  rates: ExchangeRate[],
  monthsCount: number,
  today: Date = new Date(),
): MonthlySpendSeries {
  const totalsByMonth = new Map<string, number>();
  const monthsWithRawData = new Set<string>();

  for (const row of rows) {
    const key = row.month.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
    monthsWithRawData.add(key);
    const converted = convertAmount(row.total, row.currency, orgCurrency, rates);
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + converted);
  }

  const points: MonthlySpendPoint[] = [];
  for (let i = monthsCount - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = monthKey(d.getFullYear(), d.getMonth());
    points.push({ month: key, amount: totalsByMonth.get(key) ?? 0 });
  }

  return { points, monthsWithData: monthsWithRawData.size };
}
