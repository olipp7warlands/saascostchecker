import { describe, expect, it } from "vitest";
import { seatUtilizationPct, utilizationTone, wastedSeatCost } from "./seats";

describe("seatUtilizationPct", () => {
  it("criterio de docs/TASKS.md 1.4: 12/20 asientos activos = 60%", () => {
    expect(seatUtilizationPct(12, 20)).toBe(60);
  });

  it("redondea al entero más cercano", () => {
    expect(seatUtilizationPct(41, 65)).toBe(63); // Notion del mockup
    expect(seatUtilizationPct(24, 30)).toBe(80); // Salesforce del mockup
  });

  it("100% cuando todos los asientos comprados están activos", () => {
    expect(seatUtilizationPct(19, 19)).toBe(100);
  });

  it("borde: 0 asientos comprados no divide por cero", () => {
    expect(seatUtilizationPct(0, 0)).toBe(0);
    expect(seatUtilizationPct(5, 0)).toBe(0);
  });

  it("borde: más asientos asignados que comprados supera el 100%", () => {
    expect(seatUtilizationPct(25, 20)).toBe(125);
  });
});

describe("utilizationTone", () => {
  it("es ámbar por debajo del 70%", () => {
    expect(utilizationTone(60)).toBe("amber");
    expect(utilizationTone(69)).toBe("amber");
  });

  it("es teal (primary) a partir del 70%", () => {
    expect(utilizationTone(70)).toBe("primary");
    expect(utilizationTone(80)).toBe("primary");
    expect(utilizationTone(100)).toBe("primary");
    expect(utilizationTone(125)).toBe("primary");
  });
});

describe("wastedSeatCost", () => {
  it("criterio de docs/TASKS.md 1.4: 12/20 activos sobre un contrato de 21.600€/año", () => {
    expect(wastedSeatCost(21600, 20, 12)).toBe(8640); // 8 asientos idle x 1.080€
  });

  it("0€ desperdiciados cuando todos los asientos están activos", () => {
    expect(wastedSeatCost(9120, 19, 19)).toBe(0);
  });

  it("borde: 0 asientos comprados no divide por cero", () => {
    expect(wastedSeatCost(1000, 0, 0)).toBe(0);
  });

  it("borde: más asignados que comprados no genera desperdicio negativo", () => {
    expect(wastedSeatCost(2000, 20, 25)).toBe(0);
  });
});
