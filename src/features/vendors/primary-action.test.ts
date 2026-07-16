import { describe, expect, it } from "vitest";
import { pickPrimaryAction } from "./primary-action";

const TODAY = new Date(2026, 6, 16); // 2026-07-16, fijo para tests deterministas

describe("pickPrimaryAction", () => {
  it("sin contratos activos -> addContract", () => {
    expect(pickPrimaryAction([], TODAY)).toEqual({ type: "addContract" });

    expect(
      pickPrimaryAction(
        [
          {
            id: "c1",
            status: "cancelled",
            renewalDate: "2026-08-01",
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
        ],
        TODAY,
      ),
    ).toEqual({ type: "addContract" });
  });

  it("contrato activo sin auto-renovación a 5 días -> renegotiate", () => {
    // daysUntil("2026-07-21", 2026-07-16) = 5 <= 7
    expect(
      pickPrimaryAction(
        [
          {
            id: "c2",
            status: "active",
            renewalDate: "2026-07-21",
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
        ],
        TODAY,
      ),
    ).toEqual({ type: "renegotiate", contractId: "c2" });
  });

  it("contrato activo lejos de renovar sin urgencia -> edit", () => {
    // daysUntil("2026-10-14", 2026-07-16) = 90 dias
    expect(
      pickPrimaryAction(
        [
          {
            id: "c3",
            status: "active",
            renewalDate: "2026-10-14",
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
        ],
        TODAY,
      ),
    ).toEqual({ type: "edit" });
  });

  it("auto-renovación con preaviso largo hace critica una fecha lejana -> renegotiate", () => {
    // daysUntil("2026-08-25", 2026-07-16) = 40 dias; actionable = 40 - 35 = 5 <= 7
    expect(
      pickPrimaryAction(
        [
          {
            id: "c4",
            status: "active",
            renewalDate: "2026-08-25",
            autoRenews: true,
            cancellationNoticeDays: 35,
          },
        ],
        TODAY,
      ),
    ).toEqual({ type: "renegotiate", contractId: "c4" });
  });

  it("entre varios contratos activos, elige el mas critico (menor actionableDays)", () => {
    expect(
      pickPrimaryAction(
        [
          {
            id: "far",
            status: "active",
            renewalDate: "2026-10-14", // 90 dias, no critico
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
          {
            id: "urgent",
            status: "active",
            renewalDate: "2026-07-18", // 2 dias, critico
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
          {
            id: "less-urgent",
            status: "active",
            renewalDate: "2026-07-20", // 4 dias, tambien critico pero menos
            autoRenews: false,
            cancellationNoticeDays: 30,
          },
        ],
        TODAY,
      ),
    ).toEqual({ type: "renegotiate", contractId: "urgent" });
  });
});
