import { describe, expect, it } from "vitest";
import type { ExchangeRate } from "@/features/dashboard/types";
import { computeSavings } from "./savings";

const RATES: ExchangeRate[] = [{ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9 }];

describe("computeSavings", () => {
  it("mismo par de moneda: resta directa de costes anualizados", () => {
    const result = computeSavings(1200, "annual", "EUR", 900, "annual", "EUR", "EUR", []);
    expect(result).toEqual({ previousAnnualCost: 1200, newAnnualCost: 900, savingsAmount: 300 });
  });

  it("cruce de divisa: convierte ambos lados a la moneda de la org antes de restar", () => {
    const result = computeSavings(1000, "annual", "USD", 1000, "annual", "EUR", "EUR", RATES);
    expect(result.previousAnnualCost).toBe(900); // 1000 USD -> 900 EUR
    expect(result.newAnnualCost).toBe(1000); // ya en EUR
    expect(result.savingsAmount).toBe(-100);
  });

  it("cambio de ciclo mensual->anual anualiza antes de comparar", () => {
    const result = computeSavings(100, "monthly", "EUR", 900, "annual", "EUR", "EUR", []);
    expect(result.previousAnnualCost).toBe(1200);
    expect(result.newAnnualCost).toBe(900);
    expect(result.savingsAmount).toBe(300);
  });

  it("ahorro negativo cuando el nuevo coste es mayor (renegociación que sale peor)", () => {
    const result = computeSavings(1000, "annual", "EUR", 1500, "annual", "EUR", "EUR", []);
    expect(result.savingsAmount).toBe(-500);
  });

  it("atajo de cancelación (newAmount=0): ahorro = coste anual previo completo", () => {
    const result = computeSavings(1200, "annual", "EUR", 0, "annual", "EUR", "EUR", []);
    expect(result).toEqual({ previousAnnualCost: 1200, newAnnualCost: 0, savingsAmount: 1200 });
  });
});
