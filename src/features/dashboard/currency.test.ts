import { describe, expect, it } from "vitest";
import { convertAmount } from "./currency";

const RATES = [
  { baseCurrency: "EUR", quoteCurrency: "USD", rate: 1.08 },
  { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.93 },
];

describe("convertAmount", () => {
  it("misma moneda: devuelve el importe tal cual", () => {
    expect(convertAmount(100, "EUR", "EUR", RATES)).toBe(100);
  });

  it("usa el rate directo cuando existe", () => {
    expect(convertAmount(100, "EUR", "USD", RATES)).toBeCloseTo(108);
  });

  it("usa el rate inverso cuando solo existe en la otra dirección", () => {
    const onlyDirect = [{ baseCurrency: "EUR", quoteCurrency: "GBP", rate: 0.86 }];
    expect(convertAmount(100, "GBP", "EUR", onlyDirect)).toBeCloseTo(100 / 0.86);
  });

  it("sin rate disponible: deja el importe sin convertir", () => {
    expect(convertAmount(100, "EUR", "JPY", RATES)).toBe(100);
  });
});
