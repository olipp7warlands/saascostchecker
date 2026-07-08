import { describe, expect, it } from "vitest";
import { annualizedCost, daysUntil, renewalTone } from "./renewal";

describe("daysUntil", () => {
  it("counts whole calendar days, ignoring time of day", () => {
    const today = new Date(2026, 6, 8, 23, 59); // 8 jul 2026, casi medianoche
    expect(daysUntil("2026-07-15", today)).toBe(7);
    expect(daysUntil("2026-07-08", today)).toBe(0);
  });

  it("returns a negative number for past dates", () => {
    const today = new Date(2026, 6, 8);
    expect(daysUntil("2026-07-01", today)).toBe(-7);
  });
});

describe("renewalTone", () => {
  it("es rojo a 7 días o menos", () => {
    expect(renewalTone(0)).toBe("red");
    expect(renewalTone(5)).toBe("red");
    expect(renewalTone(7)).toBe("red");
  });

  it("es ámbar entre 8 y 45 días", () => {
    expect(renewalTone(8)).toBe("amber");
    expect(renewalTone(26)).toBe("amber");
    expect(renewalTone(45)).toBe("amber");
  });

  it("es neutro más allá de 45 días", () => {
    expect(renewalTone(46)).toBe("neutral");
    expect(renewalTone(86)).toBe("neutral");
  });

  it("un contrato vencido (días negativos) sigue siendo rojo", () => {
    expect(renewalTone(-3)).toBe("red");
  });
});

describe("annualizedCost", () => {
  it("multiplica por 12 el coste mensual", () => {
    expect(annualizedCost(100, "monthly")).toBe(1200);
  });

  it("deja el coste anual tal cual", () => {
    expect(annualizedCost(1200, "annual")).toBe(1200);
  });

  it("deja el coste one_time tal cual (no tiene run-rate anual)", () => {
    expect(annualizedCost(500, "one_time")).toBe(500);
  });
});
