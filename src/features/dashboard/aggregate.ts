import { worstTone } from "@/features/renewals/calendar";
import {
  actionableDaysUntil,
  annualizedCost,
  CRITICAL_THRESHOLD_DAYS,
  daysUntil,
  renewalTone,
  WARNING_THRESHOLD_DAYS,
} from "@/features/vendors/renewal";
import { wastedSeatCost } from "@/features/vendors/seats";
import { convertAmount } from "./currency";
import type {
  CompanySpendRow,
  DashboardContract,
  DashboardKpis,
  DashboardVendor,
  DepartmentSpendRow,
  ExchangeRate,
  RenewalHeatmapDay,
  RenewalHeatmapGrid,
  RenewalHeatmapIntensity,
  RenewalHeatmapMonthLabel,
  RenewalHeatmapSelection,
  RenewalTicket,
  SavingsRecord,
  StackStatusSummary,
} from "./types";

export function buildKpis(
  contracts: DashboardContract[],
  vendors: DashboardVendor[],
  orgCurrency: string,
  rates: ExchangeRate[],
  today: Date = new Date(),
): DashboardKpis {
  const activeContracts = contracts.filter((contract) => contract.status === "active");
  const currencies = new Set<string>();

  let annualizedSpend = 0;
  let wastedLicenseCost = 0;
  let idleSeatCount = 0;
  let renewalsNext90 = 0;
  let renewalsNext30 = 0;

  for (const contract of activeContracts) {
    currencies.add(contract.currency);
    const annual = annualizedCost(contract.costAmount, contract.billingCycle);
    annualizedSpend += convertAmount(annual, contract.currency, orgCurrency, rates);

    if (contract.seatsPurchased != null && contract.seatsPurchased > 0) {
      const wasted = wastedSeatCost(annual, contract.seatsPurchased, contract.activeSeats);
      wastedLicenseCost += convertAmount(wasted, contract.currency, orgCurrency, rates);
      idleSeatCount += Math.max(contract.seatsPurchased - contract.activeSeats, 0);
    }

    // Solo próximas (0-90d): un contrato ya vencido sigue visible en la
    // pista de renovaciones, pero no cuenta como "próxima" renovación.
    const days = daysUntil(contract.renewalDate, today);
    if (days >= 0 && days <= 90) {
      renewalsNext90 += 1;
      if (days <= 30) {
        renewalsNext30 += 1;
      }
    }
  }

  const activeVendors = vendors.filter((vendor) => vendor.status === "active");

  return {
    annualizedSpend,
    activeContractCount: activeContracts.length,
    currencyCount: currencies.size,
    activeVendorCount: activeVendors.length,
    vendorsWithoutOwnerCount: activeVendors.filter((vendor) => vendor.ownerUserId == null).length,
    wastedLicenseCost,
    idleSeatCount,
    renewalsNext90,
    renewalsNext30,
  };
}

// Construye la lista de tickets de renovación (ventana por defecto: próximos
// 12 meses exactos desde "hoy", el horizonte del grid estilo GitHub — ver
// renewalHeatmapHorizonDays más abajo). Ventana, orden y tono se calculan los
// TRES sobre la fecha ACCIONABLE (actionableDaysUntil) — la misma que ya
// usan el calendario y `buildStackStatus` (donut "Estado del stack") más
// abajo. Hasta el 2026-08-06 la ventana/orden usaban días BRUTOS
// (`daysUntil`) deliberadamente, distinto del tono — una discrepancia que la
// agenda por tramos podía tolerar (el filtro solo decidía "entra o no",
// nunca una posición visual) pero que el heatmap no puede: si la columna que
// ocupa un contrato (bucketing diario, ver buildRenewalHeatmapGrid) usara
// una fecha distinta a la que decide su color, una celda mentiría sobre su
// propio tono. Se unifica todo en fecha accionable — ver docs/DECISIONS.md.
export function buildRenewalTickets(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  today: Date = new Date(),
  windowDays: number = renewalHeatmapHorizonDays(today),
): RenewalTicket[] {
  const withinWindow = contracts
    .filter((contract) => contract.status === "active")
    .map((contract) => ({
      contract,
      days: daysUntil(contract.renewalDate, today),
      actionableDays: actionableDaysUntil(
        contract.renewalDate,
        contract.autoRenews,
        contract.cancellationNoticeDays,
        today,
      ),
    }))
    .filter(({ actionableDays }) => actionableDays <= windowDays)
    .sort((a, b) => a.actionableDays - b.actionableDays);

  return withinWindow.map(({ contract, days, actionableDays }) => {
    const annualCost = annualizedCost(contract.costAmount, contract.billingCycle);
    const noticeWarning =
      contract.autoRenews &&
      contract.cancellationNoticeDays > 0 &&
      days <= contract.cancellationNoticeDays;

    return {
      contractId: contract.id,
      vendorId: contract.vendorId,
      vendorName: contract.vendorName,
      vendorWebsite: contract.vendorWebsite,
      annualCost,
      currency: contract.currency,
      annualCostOrgCurrency: convertAmount(annualCost, contract.currency, orgCurrency, rates),
      daysUntil: days,
      actionableDaysUntil: actionableDays,
      tone: renewalTone(actionableDays),
      noticeWarning,
      cancellationNoticeDays: contract.cancellationNoticeDays,
    };
  });
}

// Helpers de fecha locales, mismo patrón que src/features/renewals/calendar.ts
// (cada archivo del dominio de renovaciones tiene los suyos, sin util
// compartido — decisión ya tomada allí, no se introduce uno nuevo aquí).
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function mondayOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7)); // getDay(): 0=domingo..6=sábado
}

function sundayOfWeek(date: Date): Date {
  return addDays(mondayOfWeek(date), 6);
}

function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

// Días de calendario entre "hoy" y "hoy + 12 meses" (aritmética de meses, no
// *365 — así no se desvía en años bisiestos). Es el horizonte fijo del grid
// estilo GitHub y, a la vez, el default de `windowDays` de
// buildRenewalTickets de arriba: ambos deben leer exactamente el mismo
// horizonte para que el grid nunca excluya un ticket que la cabecera cuenta,
// ni al revés.
export function renewalHeatmapHorizonDays(today: Date = new Date()): number {
  const start = startOfDay(today);
  return daysUntil(toIsoDate(addMonths(start, 12)), today);
}

// Intensidad de una celda por nº de contratos, 3 escalones discretos (no
// continuo, pedido explícitamente): 1 = low, 2-4 = medium, 5+ = high. 0 no
// tiene intensidad (celda vacía, tratada aparte con su propia clase neutra).
export function renewalIntensity(count: number): RenewalHeatmapIntensity | null {
  if (count === 0) return null;
  if (count === 1) return "low";
  if (count <= 4) return "medium";
  return "high";
}

// Fecha efectiva de un ticket para TODO propósito posicional del heatmap
// (celda que pinta Y filtro mes/día del panel — fuente única, ver comentario
// de cabecera de este archivo/DECISIONS.md): "hoy" + días accionables, nunca
// negativo. Un contrato vencido o con preaviso ya pasado
// (actionableDaysUntil < 0) clampa a "hoy" — no tiene sentido una celda
// "ayer" en un grid que solo mira hacia adelante, y así la celda de "hoy" y
// el panel filtrado por "hoy"/el mes actual SIEMPRE coinciden.
function renewalTicketDate(ticket: RenewalTicket, today: Date): string {
  return toIsoDate(addDays(startOfDay(today), Math.max(0, ticket.actionableDaysUntil)));
}

// Etiquetas de mes del grid: SIEMPRE etiqueta la columna 0 con el mes de
// "hoy" (el día 1 de ese mes casi nunca cae dentro del grid, ya que
// `days[0]` es el lunes de la semana de "hoy", no el día 1) y además
// etiqueta la columna que contiene el día 1 de cada mes siguiente que
// aparezca en `days` (incluidos los de padding — su fecha de calendario
// sigue siendo real). Deduplicado por year+month (cubre el borde en que
// "hoy" es ya el día 1: ambas reglas coincidirían en la misma columna). Al
// final, cualquier mes que aparezca más de una vez en el horizonte (en la
// práctica: el mes de arranque, que se repite ~52 columnas después con año
// distinto) marca `showYear: true` en todas sus apariciones — sin eso,
// "agosto" y "agosto" serían indistinguibles en la UI.
function buildMonthLabels(days: RenewalHeatmapDay[]): RenewalHeatmapMonthLabel[] {
  const seen = new Set<string>();
  const labels: RenewalHeatmapMonthLabel[] = [];

  const pushLabel = (columnIndex: number, year: number, month: number) => {
    const key = `${year}-${month}`;
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({ columnIndex, year, month, showYear: false });
  };

  const first = parseIsoDate(days[0].date);
  pushLabel(0, first.getFullYear(), first.getMonth());

  days.forEach((day, index) => {
    const d = parseIsoDate(day.date);
    if (d.getDate() === 1) {
      pushLabel(Math.floor(index / 7), d.getFullYear(), d.getMonth());
    }
  });

  const countByMonth = new Map<number, number>();
  for (const label of labels) {
    countByMonth.set(label.month, (countByMonth.get(label.month) ?? 0) + 1);
  }
  for (const label of labels) {
    label.showYear = (countByMonth.get(label.month) ?? 0) > 1;
  }

  return labels;
}

// Construye el grid estilo GitHub: columnas = semanas lunes-domingo,
// cubriendo desde el lunes de la semana de "hoy" hasta el domingo que cubre
// "hoy + 12 meses". `days` es un array plano cronológico (ver tipo
// RenewalHeatmapGrid) — el bucketing de tickets por día usa un Map indexado
// por `renewalTicketDate` en vez de un filter() por celda, para no pagar
// O(días × tickets). Un ticket cuya fecha efectiva cae fuera de
// [hoy, horizonEnd] (posible si el caller construyó `tickets` con un
// `windowDays` mayor, p.ej. en tests) se ignora en el grid en vez de
// desbordar el primer/último día — el grid es fiel a "solo próximos 12
// meses", nunca acumula sobras.
export function buildRenewalHeatmapGrid(
  tickets: RenewalTicket[],
  today: Date = new Date(),
): RenewalHeatmapGrid {
  const start = startOfDay(today);
  const horizonEnd = addMonths(start, 12);
  const startIso = toIsoDate(start);
  const horizonEndIso = toIsoDate(horizonEnd);
  const gridStart = mondayOfWeek(start);
  const gridEnd = sundayOfWeek(horizonEnd);

  const byDate = new Map<string, RenewalTicket[]>();
  for (const ticket of tickets) {
    const date = renewalTicketDate(ticket, start);
    if (date < startIso || date > horizonEndIso) continue;
    const bucket = byDate.get(date);
    if (bucket) {
      bucket.push(ticket);
    } else {
      byDate.set(date, [ticket]);
    }
  }

  const days: RenewalHeatmapDay[] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    const dateIso = toIsoDate(cursor);
    const dayTickets = byDate.get(dateIso) ?? [];
    days.push({
      date: dateIso,
      isPadding: dateIso < startIso || dateIso > horizonEndIso,
      tickets: dayTickets,
      tone: worstTone(dayTickets.map((t) => t.tone)) ?? "neutral",
      intensity: renewalIntensity(dayTickets.length),
    });
  }

  return {
    weekCount: days.length / 7,
    days,
    monthLabels: buildMonthLabels(days),
  };
}

// Tickets de la selección activa del panel (mes completo o día concreto),
// ordenados por urgencia. Usa la MISMA `renewalTicketDate` que colorea el
// grid — un contrato vencido pertenece al mes/día de "hoy" en el panel
// aunque su `renewalDate` real cayera en un mes anterior, exactamente
// coherente con que su celda visual está clampada a "hoy".
export function selectRenewalTickets(
  tickets: RenewalTicket[],
  selection: RenewalHeatmapSelection,
  today: Date = new Date(),
): RenewalTicket[] {
  const start = startOfDay(today);
  return tickets
    .filter((ticket) => {
      const date = renewalTicketDate(ticket, start);
      if (selection.kind === "day") return date === selection.date;
      const d = parseIsoDate(date);
      return d.getFullYear() === selection.year && d.getMonth() === selection.month;
    })
    .sort((a, b) => a.actionableDaysUntil - b.actionableDaysUntil);
}

// Totales de un conjunto de tickets — sirve tanto para la cabecera del
// componente (todos los tickets, ya acotados a 12 meses por el default de
// windowDays de buildRenewalTickets) como para la cabecera del panel
// (tickets ya filtrados por selectRenewalTickets).
export function summarizeRenewalTickets(tickets: RenewalTicket[]): {
  contractCount: number;
  totalAnnualCostOrgCurrency: number;
} {
  return tickets.reduce(
    (acc, ticket) => ({
      contractCount: acc.contractCount + 1,
      totalAnnualCostOrgCurrency: acc.totalAnnualCostOrgCurrency + ticket.annualCostOrgCurrency,
    }),
    { contractCount: 0, totalAnnualCostOrgCurrency: 0 },
  );
}

const UNASSIGNED_KEY = "__unassigned__";

// Agrupamiento genérico de gasto anualizado por una clave del contrato
// (departamento o empresa) — misma lógica exacta, solo cambia qué campos del
// contrato se leen. buildDepartmentSpend/buildCompanySpend son wrappers finos
// sobre esto para no duplicar la agregación dos veces.
function buildSpendByKey(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  unassignedLabel: string,
  getKey: (contract: DashboardContract) => string | null,
  getName: (contract: DashboardContract) => string | null,
): { key: string | null; name: string; annualizedSpend: number; vendorCount: number }[] {
  const rows = new Map<string, { name: string; spend: number; vendorIds: Set<string> }>();

  for (const contract of contracts) {
    if (contract.status !== "active") {
      continue;
    }

    const contractKey = getKey(contract);
    const key = contractKey ?? UNASSIGNED_KEY;
    const name = contractKey ? (getName(contract) ?? "") : unassignedLabel;
    const annual = annualizedCost(contract.costAmount, contract.billingCycle);
    const converted = convertAmount(annual, contract.currency, orgCurrency, rates);

    const row = rows.get(key) ?? { name, spend: 0, vendorIds: new Set<string>() };
    row.spend += converted;
    row.vendorIds.add(contract.vendorId);
    rows.set(key, row);
  }

  return [...rows.entries()]
    .map(([key, row]) => ({
      key: key === UNASSIGNED_KEY ? null : key,
      name: row.name,
      annualizedSpend: row.spend,
      vendorCount: row.vendorIds.size,
    }))
    .sort((a, b) => b.annualizedSpend - a.annualizedSpend);
}

export function buildDepartmentSpend(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  unassignedLabel: string,
): DepartmentSpendRow[] {
  return buildSpendByKey(
    contracts,
    orgCurrency,
    rates,
    unassignedLabel,
    (c) => c.departmentId,
    (c) => c.departmentName,
  ).map((row) => ({
    departmentId: row.key,
    departmentName: row.name,
    annualizedSpend: row.annualizedSpend,
    vendorCount: row.vendorCount,
  }));
}

export function buildCompanySpend(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  unassignedLabel: string,
): CompanySpendRow[] {
  return buildSpendByKey(
    contracts,
    orgCurrency,
    rates,
    unassignedLabel,
    (c) => c.companyId,
    (c) => c.companyName,
  ).map((row) => ({
    companyId: row.key,
    companyName: row.name,
    annualizedSpend: row.annualizedSpend,
    vendorCount: row.vendorCount,
  }));
}

// Clasifica cada vendor ACTIVO (mismo filtro que activeVendorCount) por la
// urgencia de su contrato activo más próximo a ser accionable
// (actionableDaysUntil, la misma fuente única de verdad que usa
// primary-action.ts y la pista de renovaciones): crítico/próximo/estable, o
// "sin contrato activo" si el vendor no tiene ningún contrato activo del que
// colgar una fecha.
export function buildStackStatus(
  vendors: DashboardVendor[],
  contracts: DashboardContract[],
  today: Date = new Date(),
): StackStatusSummary {
  const activeContractsByVendor = new Map<string, DashboardContract[]>();
  for (const contract of contracts) {
    if (contract.status !== "active") {
      continue;
    }
    const list = activeContractsByVendor.get(contract.vendorId) ?? [];
    list.push(contract);
    activeContractsByVendor.set(contract.vendorId, list);
  }

  const summary: StackStatusSummary = { critical: 0, upcoming: 0, stable: 0, noContract: 0, total: 0 };

  for (const vendor of vendors) {
    if (vendor.status !== "active") {
      continue;
    }
    summary.total += 1;

    const activeContracts = activeContractsByVendor.get(vendor.id) ?? [];
    if (activeContracts.length === 0) {
      summary.noContract += 1;
      continue;
    }

    const minActionableDays = Math.min(
      ...activeContracts.map((contract) =>
        actionableDaysUntil(
          contract.renewalDate,
          contract.autoRenews,
          contract.cancellationNoticeDays,
          today,
        ),
      ),
    );

    if (minActionableDays <= CRITICAL_THRESHOLD_DAYS) {
      summary.critical += 1;
    } else if (minActionableDays <= WARNING_THRESHOLD_DAYS) {
      summary.upcoming += 1;
    } else {
      summary.stable += 1;
    }
  }

  return summary;
}

// Suma de savings_records.savings_amount cerrados dentro de `year` — ya están
// en la moneda de la org (guardados así en el momento de capturar, ver
// docs/DECISIONS.md), así que no hace falta convertAmount aquí, a diferencia
// del resto de agregados de este archivo.
export function buildSavingsYtd(
  records: Pick<SavingsRecord, "savingsAmount" | "closedAt">[],
  year: number,
): number {
  return records
    .filter((record) => Number(record.closedAt.slice(0, 4)) === year)
    .reduce((sum, record) => sum + record.savingsAmount, 0);
}
