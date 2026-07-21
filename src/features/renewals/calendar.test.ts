import { describe, expect, it } from "vitest";
import type { DashboardContract } from "@/features/dashboard/types";
import { buildCalendarMonth } from "./calendar";

const TODAY = new Date(2026, 6, 10); // 10 jul 2026

function contract(overrides: Partial<DashboardContract>): DashboardContract {
  return {
    id: "c1",
    vendorId: "v1",
    vendorName: "Vendor",
    vendorWebsite: "vendor.com",
    costAmount: 100,
    currency: "EUR",
    billingCycle: "annual",
    seatsPurchased: null,
    activeSeats: 0,
    renewalDate: "2026-08-01",
    autoRenews: true,
    cancellationNoticeDays: 30,
    status: "active",
    departmentId: null,
    departmentName: null,
    companyId: null,
    companyName: null,
    ...overrides,
  };
}

function findDay(days: ReturnType<typeof buildCalendarMonth>, dateIso: string) {
  const day = days.find((d) => d.date === dateIso);
  if (!day) throw new Error(`día ${dateIso} no está en la rejilla`);
  return day;
}

describe("buildCalendarMonth", () => {
  it("coloca el marcador primario en la fecha accionable (renovación - preaviso)", () => {
    const contracts = [
      contract({ id: "c1", renewalDate: "2026-08-15", autoRenews: true, cancellationNoticeDays: 30 }),
    ];
    const days = buildCalendarMonth(contracts, 2026, 6, TODAY); // julio 2026, accionable = 16 jul

    const actionableDay = findDay(days, "2026-07-16");
    expect(actionableDay.markers).toHaveLength(1);
    expect(actionableDay.markers[0]).toMatchObject({ contractId: "c1", kind: "actionable" });
  });

  it("añade un marcador secundario mudo en renewalDate cuando difiere de la fecha accionable", () => {
    const contracts = [
      contract({ id: "c1", renewalDate: "2026-07-20", autoRenews: true, cancellationNoticeDays: 15 }),
    ];
    const days = buildCalendarMonth(contracts, 2026, 6, TODAY);

    const actionableDay = findDay(days, "2026-07-05");
    const renewalDay = findDay(days, "2026-07-20");
    expect(actionableDay.markers).toEqual([expect.objectContaining({ contractId: "c1", kind: "actionable" })]);
    expect(renewalDay.markers).toEqual([
      expect.objectContaining({ contractId: "c1", kind: "informational", tone: "neutral" }),
    ]);
  });

  it("con autoRenews=false solo hay un marcador, en renewalDate", () => {
    const contracts = [contract({ id: "c1", renewalDate: "2026-07-20", autoRenews: false })];
    const days = buildCalendarMonth(contracts, 2026, 6, TODAY);

    const renewalDay = findDay(days, "2026-07-20");
    expect(renewalDay.markers).toHaveLength(1);
    expect(renewalDay.markers[0].kind).toBe("actionable");
    expect(days.flatMap((d) => d.markers)).toHaveLength(1);
  });

  it("con cancellationNoticeDays=0 solo hay un marcador (accionable == renewalDate)", () => {
    const contracts = [
      contract({ id: "c1", renewalDate: "2026-07-20", autoRenews: true, cancellationNoticeDays: 0 }),
    ];
    const days = buildCalendarMonth(contracts, 2026, 6, TODAY);

    expect(days.flatMap((d) => d.markers)).toHaveLength(1);
    expect(findDay(days, "2026-07-20").markers[0].kind).toBe("actionable");
  });

  it("excluye contratos cancelados", () => {
    const contracts = [
      contract({ id: "c1", renewalDate: "2026-07-20", status: "cancelled", autoRenews: false }),
    ];
    const days = buildCalendarMonth(contracts, 2026, 6, TODAY);

    expect(days.flatMap((d) => d.markers)).toHaveLength(0);
  });

  it("la rejilla siempre tiene 42 días", () => {
    expect(buildCalendarMonth([], 2026, 6, TODAY)).toHaveLength(42);
    expect(buildCalendarMonth([], 2026, 1, TODAY)).toHaveLength(42); // febrero
  });

  it("el primer día de la rejilla siempre es lunes, cualquiera sea el mes", () => {
    for (let month = 0; month < 12; month++) {
      const days = buildCalendarMonth([], 2026, month, TODAY);
      expect(new Date(`${days[0].date}T00:00:00`).getDay()).toBe(1);
    }
  });

  it("diciembre→enero: la rejilla se extiende al mes siguiente marcado isCurrentMonth=false", () => {
    const days = buildCalendarMonth([], 2026, 11, TODAY); // diciembre 2026
    const trailingJan = days.filter((d) => d.date.startsWith("2027-01"));
    expect(trailingJan.length).toBeGreaterThan(0);
    expect(trailingJan.every((d) => !d.isCurrentMonth)).toBe(true);
    const decemberDays = days.filter((d) => d.isCurrentMonth);
    expect(decemberDays).toHaveLength(31);
  });

  it("febrero de un año bisiesto incluye el día 29 dentro del mes actual", () => {
    const days = buildCalendarMonth([], 2028, 1, TODAY); // 2028 es bisiesto
    const feb29 = findDay(days, "2028-02-29");
    expect(feb29.isCurrentMonth).toBe(true);
  });
});
