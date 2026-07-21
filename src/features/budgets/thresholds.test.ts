import { describe, expect, it } from "vitest";
import { budgetTone } from "./thresholds";

describe("budgetTone", () => {
  it("es estable si el ritmo de consumo va igual o algo por debajo del calendario", () => {
    expect(budgetTone(500, 1000, 0.5)).toBe("stable"); // 50% consumido, 50% del año
    expect(budgetTone(400, 1000, 0.5)).toBe("stable"); // por debajo del ritmo
  });

  it("es próximo entre 1.05x y 1.25x el ritmo del calendario", () => {
    expect(budgetTone(600, 1000, 0.5)).toBe("upcoming"); // ritmo 1.2x
  });

  it("es crítico por encima de 1.25x el ritmo del calendario", () => {
    expect(budgetTone(700, 1000, 0.5)).toBe("critical"); // ritmo 1.4x
  });

  it("es siempre crítico si el presupuesto ya está agotado, sin importar el ritmo", () => {
    expect(budgetTone(1000, 1000, 0.1)).toBe("critical");
    expect(budgetTone(1200, 1000, 0.1)).toBe("critical");
  });

  it("con 0% de año transcurrido, cualquier consumo ya es crítico", () => {
    expect(budgetTone(1, 1000, 0)).toBe("critical");
    expect(budgetTone(0, 1000, 0)).toBe("stable");
  });

  it("una bolsa presupuestada en 0 con cualquier consumo es crítica", () => {
    expect(budgetTone(1, 0, 0.5)).toBe("critical");
    expect(budgetTone(0, 0, 0.5)).toBe("stable");
  });
});
