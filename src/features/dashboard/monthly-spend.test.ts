import { describe, expect, it } from "vitest";
import { buildMonthlySpendSeries } from "./monthly-spend";
import type { MonthlySpendRow } from "./types";

const TODAY = new Date(2026, 6, 10); // 10 jul 2026

describe("buildMonthlySpendSeries", () => {
  it("rellena a 0 los meses de la ventana sin ninguna fila", () => {
    const rows: MonthlySpendRow[] = [{ month: "2026-07-01", currency: "EUR", total: 100 }];

    const series = buildMonthlySpendSeries(rows, "EUR", [], 3, TODAY);

    expect(series.points).toEqual([
      { month: "2026-05", amount: 0 },
      { month: "2026-06", amount: 0 },
      { month: "2026-07", amount: 100 },
    ]);
    expect(series.monthsWithData).toBe(1);
  });

  it("convierte y suma varias monedas dentro del mismo mes", () => {
    const rows: MonthlySpendRow[] = [
      { month: "2026-07-01", currency: "EUR", total: 100 },
      { month: "2026-07-01", currency: "USD", total: 1000 },
    ];
    const rates = [{ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9 }];

    const series = buildMonthlySpendSeries(rows, "EUR", rates, 1, TODAY);

    expect(series.points).toEqual([{ month: "2026-07", amount: 1000 }]); // 100 + 1000*0.9
  });

  it("monthsWithData cuenta los meses distintos con al menos una fila real", () => {
    const rows: MonthlySpendRow[] = [
      { month: "2026-06-01", currency: "EUR", total: 50 },
      { month: "2026-07-01", currency: "EUR", total: 75 },
    ];

    const series = buildMonthlySpendSeries(rows, "EUR", [], 12, TODAY);

    expect(series.monthsWithData).toBe(2);
    expect(series.points).toHaveLength(12);
  });
});
