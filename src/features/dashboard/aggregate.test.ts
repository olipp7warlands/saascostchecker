import { describe, expect, it } from "vitest";
import {
  buildCompanySpend,
  buildDepartmentSpend,
  buildKpis,
  buildRenewalHeatmapGrid,
  buildRenewalTickets,
  buildSavingsYtd,
  buildStackStatus,
  renewalHeatmapHorizonDays,
  renewalIntensity,
  selectRenewalTickets,
  summarizeRenewalTickets,
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

describe("buildRenewalTickets", () => {
  const RATES = [{ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9 }];

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
      id: "usd",
      currency: "USD",
      costAmount: 1000,
      billingCycle: "annual",
      renewalDate: isoDaysFrom(TODAY, 26),
    }),
    contract({
      // 200d brutos, con el preaviso por defecto (30d) sigue quedando fuera
      // de la ventana de 120d incluso por fecha accionable (200-30=170).
      id: "outside-window",
      renewalDate: isoDaysFrom(TODAY, 200),
    }),
    contract({
      id: "cancelled",
      renewalDate: isoDaysFrom(TODAY, 5),
      status: "cancelled",
    }),
  ];

  const tickets = buildRenewalTickets(contracts, "EUR", RATES, TODAY, 120);

  it("excluye contratos cancelados y fuera de la ventana, ordena por fecha accionable ascendente", () => {
    // accionables: overdue -33, hot -25, usd -4, soon 12 (no por daysUntil bruto,
    // que daría overdue/hot/soon/usd con soon y usd empatados a 26d).
    expect(tickets.map((t) => t.contractId)).toEqual(["overdue", "hot", "usd", "soon"]);
  });

  it("los vencidos mantienen días negativos y tono rojo, sin ocultarse", () => {
    const overdue = tickets.find((t) => t.contractId === "overdue")!;
    expect(overdue.daysUntil).toBe(-3);
    expect(overdue.tone).toBe("red");
  });

  it("marca aviso de preaviso cuando el plazo de cancelación ya está dentro de los días restantes", () => {
    const hot = tickets.find((t) => t.contractId === "hot")!;
    expect(hot.noticeWarning).toBe(true); // 5d restantes <= 30d de preaviso

    const soon = tickets.find((t) => t.contractId === "soon")!;
    expect(soon.noticeWarning).toBe(false); // 26d restantes > 14d de preaviso
    expect(soon.tone).toBe("amber");
  });

  it("el tono y actionableDaysUntil se calculan con la fecha accionable (preaviso descontado), no con daysUntil bruto", () => {
    const soon = tickets.find((t) => t.contractId === "soon")!;
    expect(soon.daysUntil).toBe(26);
    expect(soon.actionableDaysUntil).toBe(12); // 26d - 14d de preaviso

    const usd = tickets.find((t) => t.contractId === "usd")!;
    expect(usd.daysUntil).toBe(26);
    expect(usd.actionableDaysUntil).toBe(-4); // 26d - 30d de preaviso (por defecto), ya fuera de plazo
    expect(usd.tone).toBe("red");
  });

  it("mantiene el coste anual en moneda nativa por fila, pero convierte annualCostOrgCurrency a la moneda de la org", () => {
    const usd = tickets.find((t) => t.contractId === "usd")!;
    expect(usd.currency).toBe("USD");
    expect(usd.annualCost).toBe(1000);
    expect(usd.annualCostOrgCurrency).toBeCloseTo(900); // 1000 * 0.9
  });

  it("incluye contratos cuya fecha bruta excede la ventana pero cuya fecha accionable cae dentro (fix 2026-08-06: ventana también por fecha accionable)", () => {
    const farButActionable = contract({
      id: "far-but-actionable",
      renewalDate: isoDaysFrom(TODAY, 140),
      autoRenews: true,
      cancellationNoticeDays: 30, // accionable: 140-30 = 110 <= 120
    });
    const [ticket] = buildRenewalTickets([farButActionable], "EUR", [], TODAY, 120);
    expect(ticket).toBeDefined();
    expect(ticket.actionableDaysUntil).toBe(110);
  });

  it("ordena por fecha accionable ascendente incluso cuando difiere del orden por daysUntil bruto", () => {
    const laterRawSoonerActionable = contract({
      id: "later-raw",
      renewalDate: isoDaysFrom(TODAY, 45),
      autoRenews: true,
      cancellationNoticeDays: 40, // accionable: 5
    });
    const soonerRawLaterActionable = contract({
      id: "sooner-raw",
      renewalDate: isoDaysFrom(TODAY, 40),
      autoRenews: false, // accionable: 40
    });
    const ordered = buildRenewalTickets(
      [soonerRawLaterActionable, laterRawSoonerActionable],
      "EUR",
      [],
      TODAY,
      120,
    );
    expect(ordered.map((t) => t.contractId)).toEqual(["later-raw", "sooner-raw"]);
  });

  it("test explícito de la discrepancia resuelta: 40 días brutos con 35 de preaviso -> crítico (5 días accionables)", () => {
    const overlappingNotice = contract({
      id: "notice-critical",
      renewalDate: isoDaysFrom(TODAY, 40),
      autoRenews: true,
      cancellationNoticeDays: 35,
    });
    const [ticket] = buildRenewalTickets([overlappingNotice], "EUR", [], TODAY, 120);
    expect(ticket.daysUntil).toBe(40);
    expect(ticket.actionableDaysUntil).toBe(5);
    expect(ticket.tone).toBe("red");
  });
});

describe("renewalIntensity", () => {
  it("0 contratos -> null (celda vacía, fuera de la escala)", () => {
    expect(renewalIntensity(0)).toBeNull();
  });

  it("1 contrato -> low", () => {
    expect(renewalIntensity(1)).toBe("low");
  });

  it("2 a 4 contratos -> medium", () => {
    expect(renewalIntensity(2)).toBe("medium");
    expect(renewalIntensity(4)).toBe("medium");
  });

  it("5 o más contratos -> high", () => {
    expect(renewalIntensity(5)).toBe("high");
    expect(renewalIntensity(20)).toBe("high");
  });
});

describe("renewalHeatmapHorizonDays", () => {
  it("días exactos hasta la misma fecha de calendario 12 meses después (aritmética de meses, no *365)", () => {
    expect(renewalHeatmapHorizonDays(TODAY)).toBe(365); // 10 jul 2026 -> 10 jul 2027, no cruza 29 feb
  });

  it("cuando el horizonte cruza un 29 de febrero, son 366 días", () => {
    const leapToday = new Date(2027, 6, 10); // 10 jul 2027 -> 10 jul 2028 (2028 es bisiesto)
    expect(renewalHeatmapHorizonDays(leapToday)).toBe(366);
  });
});

describe("buildRenewalHeatmapGrid", () => {
  it("cubre del lunes de la semana de hoy al domingo que cubre el horizonte, longitud múltiplo de 7", () => {
    const grid = buildRenewalHeatmapGrid([], TODAY);
    expect(grid.days.length).toBe(grid.weekCount * 7);
    expect(grid.days.length % 7).toBe(0);

    const first = new Date(`${grid.days[0].date}T00:00:00`);
    const last = new Date(`${grid.days[grid.days.length - 1].date}T00:00:00`);
    expect(first.getDay()).toBe(1); // lunes
    expect(last.getDay()).toBe(0); // domingo
  });

  it("marca isPadding en los días antes de hoy y después del horizonte; hoy mismo no es padding", () => {
    const grid = buildRenewalHeatmapGrid([], TODAY);
    const todayIso = isoDaysFrom(TODAY, 0);
    const todayCell = grid.days.find((day) => day.date === todayIso)!;
    expect(todayCell.isPadding).toBe(false);

    const beforeToday = grid.days.filter((day) => day.date < todayIso);
    expect(beforeToday.length).toBeGreaterThan(0);
    expect(beforeToday.every((day) => day.isPadding)).toBe(true);

    const horizonEndIso = isoDaysFrom(TODAY, renewalHeatmapHorizonDays(TODAY));
    const afterHorizon = grid.days.filter((day) => day.date > horizonEndIso);
    expect(afterHorizon.length).toBeGreaterThan(0);
    expect(afterHorizon.every((day) => day.isPadding)).toBe(true);
  });

  it("un ticket vencido o con preaviso ya pasado clampa al día de hoy, no a un día anterior ni queda ausente", () => {
    const contracts: DashboardContract[] = [
      contract({ id: "overdue", renewalDate: isoDaysFrom(TODAY, -10), autoRenews: false }),
      contract({
        id: "notice-passed",
        renewalDate: isoDaysFrom(TODAY, 5),
        autoRenews: true,
        cancellationNoticeDays: 30, // accionable: -25
      }),
    ];
    const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY);
    const grid = buildRenewalHeatmapGrid(tickets, TODAY);
    const todayCell = grid.days.find((day) => day.date === isoDaysFrom(TODAY, 0))!;

    expect(todayCell.tickets.map((t) => t.contractId).sort()).toEqual(["notice-passed", "overdue"]);
    expect(grid.days.filter((day) => day.date !== todayCell.date).every((day) => day.tickets.length === 0)).toBe(
      true,
    );
  });

  it("un ticket justo en el borde del horizonte se incluye; uno 5 días más allá se ignora silenciosamente", () => {
    const horizon = renewalHeatmapHorizonDays(TODAY);
    const contracts: DashboardContract[] = [
      contract({ id: "edge", renewalDate: isoDaysFrom(TODAY, horizon), autoRenews: false }),
      contract({ id: "beyond", renewalDate: isoDaysFrom(TODAY, horizon + 5), autoRenews: false }),
    ];
    // windowDays generoso para que buildRenewalTickets no los excluya antes
    // de que el grid tenga oportunidad de filtrar por su cuenta.
    const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY, horizon + 10);
    const grid = buildRenewalHeatmapGrid(tickets, TODAY);
    const allTicketIds = grid.days.flatMap((day) => day.tickets.map((t) => t.contractId));

    expect(allTicketIds).toEqual(["edge"]);
  });

  it("intensidad por día: nº de tickets que caen el mismo día produce low/medium/high", () => {
    const contracts: DashboardContract[] = [
      contract({ id: "low-1", renewalDate: isoDaysFrom(TODAY, 3), autoRenews: false }),
      contract({ id: "med-1", renewalDate: isoDaysFrom(TODAY, 10), autoRenews: false }),
      contract({ id: "med-2", renewalDate: isoDaysFrom(TODAY, 10), autoRenews: false }),
      contract({ id: "med-3", renewalDate: isoDaysFrom(TODAY, 10), autoRenews: false }),
      contract({ id: "high-1", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }),
      contract({ id: "high-2", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }),
      contract({ id: "high-3", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }),
      contract({ id: "high-4", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }),
      contract({ id: "high-5", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }),
    ];
    const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY);
    const grid = buildRenewalHeatmapGrid(tickets, TODAY);

    expect(grid.days.find((day) => day.date === isoDaysFrom(TODAY, 3))!.intensity).toBe("low");
    expect(grid.days.find((day) => day.date === isoDaysFrom(TODAY, 10))!.intensity).toBe("medium");
    expect(grid.days.find((day) => day.date === isoDaysFrom(TODAY, 20))!.intensity).toBe("high");
  });

  it("celda sin contratos tiene tone neutral e intensity null", () => {
    const grid = buildRenewalHeatmapGrid([], TODAY);
    expect(
      grid.days.every((day) => day.isPadding || (day.tone === "neutral" && day.intensity === null && day.tickets.length === 0)),
    ).toBe(true);
  });
});

describe("buildMonthLabels (grid.monthLabels)", () => {
  it("13 etiquetas para un horizonte de 12 meses; el mes de arranque se repite con showYear en ambas apariciones", () => {
    const grid = buildRenewalHeatmapGrid([], TODAY); // TODAY = 10 jul 2026
    expect(grid.monthLabels).toHaveLength(13);

    const julyLabels = grid.monthLabels.filter((label) => label.month === 6);
    expect(julyLabels).toHaveLength(2);
    expect(julyLabels.map((label) => label.year).sort()).toEqual([2026, 2027]);
    expect(julyLabels.every((label) => label.showYear)).toBe(true);

    const nonJuly = grid.monthLabels.filter((label) => label.month !== 6);
    expect(nonJuly.every((label) => !label.showYear)).toBe(true);
    expect(grid.monthLabels[0]).toMatchObject({ columnIndex: 0, year: 2026, month: 6 });
  });

  it("etiquetas ordenadas por columnIndex ascendente", () => {
    const grid = buildRenewalHeatmapGrid([], TODAY);
    const indices = grid.monthLabels.map((label) => label.columnIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("borde de cambio de año: diciembre etiqueta la columna que contiene el 1 de enero del año siguiente", () => {
    const yearEndToday = new Date(2026, 11, 20); // 20 dic 2026
    const grid = buildRenewalHeatmapGrid([], yearEndToday);

    const january = grid.monthLabels.find((label) => label.month === 0);
    expect(january?.year).toBe(2027);

    const decemberLabels = grid.monthLabels.filter((label) => label.month === 11);
    expect(decemberLabels).toHaveLength(2); // dic 2026 (arranque) y dic 2027 (fin de horizonte)
    expect(decemberLabels.every((label) => label.showYear)).toBe(true);
  });

  it("cuando hoy es el día 1 de su mes, no hay entrada duplicada (columna 0 y regla del día 1 coinciden)", () => {
    const firstOfMonthToday = new Date(2026, 7, 1); // 1 ago 2026
    const grid = buildRenewalHeatmapGrid([], firstOfMonthToday);
    const august2026 = grid.monthLabels.filter((label) => label.year === 2026 && label.month === 7);

    expect(august2026).toHaveLength(1);
    expect(august2026[0].columnIndex).toBe(0);
  });
});

describe("selectRenewalTickets", () => {
  const contracts: DashboardContract[] = [
    contract({ id: "today", renewalDate: isoDaysFrom(TODAY, 0), autoRenews: false }),
    contract({ id: "overdue", renewalDate: isoDaysFrom(TODAY, -10), autoRenews: false }), // clampa a hoy (jun -> jul)
    contract({ id: "later-this-month", renewalDate: isoDaysFrom(TODAY, 15), autoRenews: false }),
    contract({ id: "next-month", renewalDate: isoDaysFrom(TODAY, 45), autoRenews: false }),
  ];
  const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY);

  it("selección por mes devuelve solo tickets de ese año/mes, ordenados por urgencia ascendente", () => {
    const julyTickets = selectRenewalTickets(tickets, { kind: "month", year: 2026, month: 6 }, TODAY);
    expect(julyTickets.map((t) => t.contractId)).toEqual(["overdue", "today", "later-this-month"]);
  });

  it("selección por día devuelve solo tickets con esa fecha exacta, incluidos los vencidos clampados", () => {
    const todayTickets = selectRenewalTickets(tickets, { kind: "day", date: isoDaysFrom(TODAY, 0) }, TODAY);
    expect(todayTickets.map((t) => t.contractId).sort()).toEqual(["overdue", "today"]);
  });

  it('un vencido pertenece al mes de "hoy" en el panel, no al mes de su renewalDate original', () => {
    // "overdue" tiene renewalDate en junio 2026, pero su fecha efectiva
    // clampa a hoy (julio) -> no debe aparecer al filtrar junio.
    const juneTickets = selectRenewalTickets(tickets, { kind: "month", year: 2026, month: 5 }, TODAY);
    expect(juneTickets.map((t) => t.contractId)).not.toContain("overdue");
    expect(juneTickets).toHaveLength(0);
  });

  it("un mes futuro distinto solo devuelve lo que cae en él", () => {
    const augustTickets = selectRenewalTickets(tickets, { kind: "month", year: 2026, month: 7 }, TODAY);
    expect(augustTickets.map((t) => t.contractId)).toEqual(["next-month"]);
  });
});

describe("summarizeRenewalTickets", () => {
  it("suma nº de contratos y coste anual total en la moneda de la org", () => {
    const contracts: DashboardContract[] = [
      contract({ id: "a", renewalDate: isoDaysFrom(TODAY, 3), costAmount: 1000, billingCycle: "annual", autoRenews: false }),
      contract({ id: "b", renewalDate: isoDaysFrom(TODAY, 20), costAmount: 500, billingCycle: "annual", autoRenews: false }),
    ];
    const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY);
    expect(summarizeRenewalTickets(tickets)).toEqual({ contractCount: 2, totalAnnualCostOrgCurrency: 1500 });
  });

  it("devuelve ceros con un array vacío", () => {
    expect(summarizeRenewalTickets([])).toEqual({ contractCount: 0, totalAnnualCostOrgCurrency: 0 });
  });
});

// Verificación cruzada automatizada (mismo chequeo que se hizo a mano contra
// datos reales el 2026-08-04 para agenda vs. donut, y el 2026-08-06 para el
// heatmap semanal vs. donut, ahora para el grid diario vs. donut): con un
// contrato activo por vendor, los conteos por tono deben coincidir
// exactamente entre buildStackStatus (agrupa por vendor) y los tickets del
// grid (agrupan por contrato) — la equivalencia 1:1 depende de que cada
// vendor tenga un único contrato activo en este fixture, todos dentro del
// horizonte de 12 meses.
describe("consistencia heatmap vs buildStackStatus (mismo universo de datos)", () => {
  it("los conteos por tono coinciden con el donut cuando cada vendor tiene exactamente 1 contrato activo dentro del horizonte", () => {
    const vendors: DashboardVendor[] = [
      { id: "v1", status: "active", ownerUserId: null },
      { id: "v2", status: "active", ownerUserId: null },
      { id: "v3", status: "active", ownerUserId: null },
      { id: "v4", status: "active", ownerUserId: null },
      { id: "v5", status: "active", ownerUserId: null },
      { id: "v6", status: "active", ownerUserId: null },
    ];
    const contracts: DashboardContract[] = [
      contract({ id: "c1", vendorId: "v1", renewalDate: isoDaysFrom(TODAY, 3), autoRenews: false }), // critical
      contract({ id: "c2", vendorId: "v2", renewalDate: isoDaysFrom(TODAY, 5), autoRenews: false }), // critical
      contract({ id: "c3", vendorId: "v3", renewalDate: isoDaysFrom(TODAY, 20), autoRenews: false }), // upcoming
      contract({ id: "c4", vendorId: "v4", renewalDate: isoDaysFrom(TODAY, 40), autoRenews: false }), // upcoming
      contract({ id: "c5", vendorId: "v5", renewalDate: isoDaysFrom(TODAY, 90), autoRenews: false }), // stable
      contract({ id: "c6", vendorId: "v6", renewalDate: isoDaysFrom(TODAY, 100), autoRenews: false }), // stable
    ];

    const stackStatus = buildStackStatus(vendors, contracts, TODAY);
    expect(stackStatus).toEqual({ critical: 2, upcoming: 2, stable: 2, noContract: 0, total: 6 });

    const tickets = buildRenewalTickets(contracts, "EUR", [], TODAY);
    expect(tickets.filter((t) => t.tone === "red")).toHaveLength(stackStatus.critical);
    expect(tickets.filter((t) => t.tone === "amber")).toHaveLength(stackStatus.upcoming);
    expect(tickets.filter((t) => t.tone === "neutral")).toHaveLength(stackStatus.stable);
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
