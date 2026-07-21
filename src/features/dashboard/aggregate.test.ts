import { describe, expect, it } from "vitest";
import {
  buildCompanySpend,
  buildDepartmentSpend,
  buildKpis,
  buildRenewalTrack,
  buildSavingsYtd,
  buildStackStatus,
} from "./aggregate";
import type { DashboardContract, DashboardVendor, SavingsRecord } from "./types";

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

function isoDaysFrom(today: Date, days: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("buildKpis", () => {
  const RATES = [{ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9 }];

  const contracts: DashboardContract[] = [
    contract({
      id: "c1",
      currency: "EUR",
      costAmount: 100,
      billingCycle: "monthly", // anualizado: 1200
      seatsPurchased: 10,
      activeSeats: 6, // 4 idle -> wasted = (1200/10)*4 = 480
      renewalDate: isoDaysFrom(TODAY, 5),
    }),
    contract({
      id: "c2",
      currency: "USD",
      costAmount: 1000,
      billingCycle: "annual",
      seatsPurchased: null,
      renewalDate: isoDaysFrom(TODAY, 100), // fuera de la ventana de 90d
    }),
    contract({
      id: "c3",
      currency: "EUR",
      costAmount: 5000,
      billingCycle: "annual",
      status: "cancelled", // excluido de todos los KPIs
      renewalDate: isoDaysFrom(TODAY, 5),
    }),
    contract({
      id: "c4",
      currency: "EUR",
      costAmount: 200,
      billingCycle: "one_time",
      seatsPurchased: 0, // sin asientos que desperdiciar
      renewalDate: isoDaysFrom(TODAY, 40),
    }),
  ];

  const vendors: DashboardVendor[] = [
    { id: "v1", status: "active", ownerUserId: null },
    { id: "v2", status: "active", ownerUserId: "u1" },
    { id: "v3", status: "inactive", ownerUserId: null },
  ];

  const kpis = buildKpis(contracts, vendors, "EUR", RATES, TODAY);

  it("anualiza y convierte el gasto de contratos activos, excluye cancelados", () => {
    // 1200 (EUR) + 1000*0.9 (USD->EUR) + 200 (EUR) = 2300
    expect(kpis.annualizedSpend).toBeCloseTo(2300);
    expect(kpis.activeContractCount).toBe(3);
    expect(kpis.currencyCount).toBe(2);
  });

  it("cuenta vendors activos y sin owner", () => {
    expect(kpis.activeVendorCount).toBe(2);
    expect(kpis.vendorsWithoutOwnerCount).toBe(1);
  });

  it("suma € desperdiciado y asientos inactivos solo de contratos con asientos comprados", () => {
    expect(kpis.wastedLicenseCost).toBeCloseTo(480);
    expect(kpis.idleSeatCount).toBe(4);
  });

  it("cuenta renovaciones en 90d y el subconjunto de 30d, ignora las que exceden 90d", () => {
    expect(kpis.renewalsNext90).toBe(2); // c1 (5d) y c4 (40d), no c2 (100d)
    expect(kpis.renewalsNext30).toBe(1); // solo c1 (5d)
  });
});

describe("buildRenewalTrack", () => {
  const contracts: DashboardContract[] = [
    contract({
      id: "overdue",
      renewalDate: isoDaysFrom(TODAY, -3),
      autoRenews: true,
      cancellationNoticeDays: 30,
    }),
    contract({
      id: "hot",
      renewalDate: isoDaysFrom(TODAY, 5),
      autoRenews: true,
      cancellationNoticeDays: 30,
    }),
    contract({
      id: "soon",
      renewalDate: isoDaysFrom(TODAY, 26),
      autoRenews: true,
      cancellationNoticeDays: 14,
    }),
    contract({
      id: "outside-window",
      renewalDate: isoDaysFrom(TODAY, 150),
    }),
    contract({
      id: "cancelled",
      renewalDate: isoDaysFrom(TODAY, 5),
      status: "cancelled",
    }),
  ];

  const tickets = buildRenewalTrack(contracts, TODAY, 120);

  it("excluye contratos cancelados y fuera de la ventana", () => {
    expect(tickets.map((t) => t.contractId)).toEqual(["overdue", "hot", "soon"]);
  });

  it("clampa los vencidos a la posición 0% en vez de ocultarlos", () => {
    const overdue = tickets.find((t) => t.contractId === "overdue")!;
    expect(overdue.daysUntil).toBe(-3);
    expect(overdue.xPercent).toBe(0);
    expect(overdue.tone).toBe("red");
  });

  it("marca aviso de preaviso cuando el plazo de cancelación ya está dentro de los días restantes", () => {
    const hot = tickets.find((t) => t.contractId === "hot")!;
    expect(hot.noticeWarning).toBe(true); // 5d restantes <= 30d de preaviso

    const soon = tickets.find((t) => t.contractId === "soon")!;
    expect(soon.noticeWarning).toBe(false); // 26d restantes > 14d de preaviso
    expect(soon.tone).toBe("amber");
  });

  it("asigna carriles alternos cuando dos tickets caen demasiado cerca en el eje", () => {
    const overdue = tickets.find((t) => t.contractId === "overdue")!;
    const hot = tickets.find((t) => t.contractId === "hot")!;
    const soon = tickets.find((t) => t.contractId === "soon")!;
    expect(overdue.lane).toBe(0);
    expect(hot.lane).toBe(1); // demasiado cerca de "overdue" en el eje x
    expect(soon.lane).toBe(0); // suficientemente lejos, vuelve al carril 0
  });
});

describe("buildDepartmentSpend", () => {
  const contracts: DashboardContract[] = [
    contract({
      id: "d1",
      vendorId: "v1",
      costAmount: 1200,
      billingCycle: "annual",
      departmentId: "dept-a",
      departmentName: "Ingeniería",
    }),
    contract({
      id: "d2",
      vendorId: "v2",
      costAmount: 600,
      billingCycle: "annual",
      departmentId: "dept-a",
      departmentName: "Ingeniería",
    }),
    contract({
      id: "d3",
      vendorId: "v3",
      costAmount: 300,
      billingCycle: "annual",
      departmentId: null,
    }),
    contract({
      id: "d4",
      vendorId: "v4",
      costAmount: 9999,
      billingCycle: "annual",
      departmentId: "dept-b",
      departmentName: "Ventas",
      status: "cancelled", // excluido
    }),
  ];

  const rows = buildDepartmentSpend(contracts, "EUR", [], "General / Sin asignar");

  it("agrupa por departamento, suma solo contratos activos, ordena por gasto desc", () => {
    expect(rows).toEqual([
      { departmentId: "dept-a", departmentName: "Ingeniería", annualizedSpend: 1800, vendorCount: 2 },
      {
        departmentId: null,
        departmentName: "General / Sin asignar",
        annualizedSpend: 300,
        vendorCount: 1,
      },
    ]);
  });
});

describe("buildCompanySpend", () => {
  const contracts: DashboardContract[] = [
    contract({
      id: "e1",
      vendorId: "v1",
      costAmount: 2000,
      billingCycle: "annual",
      companyId: "co-a",
      companyName: "Acme ES",
    }),
    contract({
      id: "e2",
      vendorId: "v2",
      costAmount: 500,
      billingCycle: "annual",
      companyId: null,
    }),
    contract({
      id: "e3",
      vendorId: "v3",
      costAmount: 9999,
      billingCycle: "annual",
      companyId: "co-b",
      companyName: "Acme US",
      status: "cancelled", // excluido
    }),
  ];

  const rows = buildCompanySpend(contracts, "EUR", [], "Grupo / Sin asignar");

  it("agrupa por empresa igual que por departamento, suma solo activos, ordena por gasto desc", () => {
    expect(rows).toEqual([
      { companyId: "co-a", companyName: "Acme ES", annualizedSpend: 2000, vendorCount: 1 },
      { companyId: null, companyName: "Grupo / Sin asignar", annualizedSpend: 500, vendorCount: 1 },
    ]);
  });
});

describe("buildStackStatus", () => {
  const vendors: DashboardVendor[] = [
    { id: "v1", status: "active", ownerUserId: null }, // crítico
    { id: "v2", status: "active", ownerUserId: null }, // próximo
    { id: "v3", status: "active", ownerUserId: null }, // estable
    { id: "v4", status: "active", ownerUserId: null }, // sin contrato activo (0 contratos)
    { id: "v5", status: "active", ownerUserId: null }, // solo contrato cancelado -> sin contrato activo
    { id: "v6", status: "inactive", ownerUserId: null }, // excluido: vendor no activo
  ];

  const contracts: DashboardContract[] = [
    contract({ id: "c1", vendorId: "v1", renewalDate: isoDaysFrom(TODAY, 3), autoRenews: false }),
    contract({ id: "c2", vendorId: "v2", renewalDate: isoDaysFrom(TODAY, 30), autoRenews: false }),
    contract({ id: "c3", vendorId: "v3", renewalDate: isoDaysFrom(TODAY, 90), autoRenews: false }),
    contract({
      id: "c5",
      vendorId: "v5",
      renewalDate: isoDaysFrom(TODAY, 200),
      status: "cancelled",
    }),
  ];

  const summary = buildStackStatus(vendors, contracts, TODAY);

  it("clasifica cada vendor activo por la urgencia de su contrato más próximo", () => {
    expect(summary).toEqual({ critical: 1, upcoming: 1, stable: 1, noContract: 2, total: 5 });
  });
});

describe("buildSavingsYtd", () => {
  function savingsRecord(overrides: Partial<SavingsRecord>): SavingsRecord {
    return {
      id: "s1",
      vendorId: "v1",
      vendorName: "Vendor",
      kind: "renegotiated",
      savingsAmount: 100,
      closedAt: "2026-03-01",
      ...overrides,
    };
  }

  it("suma solo los registros cerrados dentro del año pedido", () => {
    const records = [
      savingsRecord({ id: "s1", savingsAmount: 100, closedAt: "2026-01-15" }),
      savingsRecord({ id: "s2", savingsAmount: 50, closedAt: "2026-12-31" }),
      savingsRecord({ id: "s3", savingsAmount: 9999, closedAt: "2025-12-31" }),
      savingsRecord({ id: "s4", savingsAmount: 9999, closedAt: "2027-01-01" }),
    ];
    expect(buildSavingsYtd(records, 2026)).toBe(150);
  });

  it("incluye ahorros negativos (renegociaciones que salieron peor) en la suma", () => {
    const records = [
      savingsRecord({ savingsAmount: 300, closedAt: "2026-02-01" }),
      savingsRecord({ savingsAmount: -50, closedAt: "2026-06-01" }),
    ];
    expect(buildSavingsYtd(records, 2026)).toBe(250);
  });

  it("devuelve 0 sin registros", () => {
    expect(buildSavingsYtd([], 2026)).toBe(0);
  });
});
