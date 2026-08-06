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
  RenewalHeatmapIntensity,
  RenewalHeatmapWeek,
  RenewalTicket,
  SavingsRecord,
  StackStatusSummary,
} from "./types";

const RENEWAL_WINDOW_DAYS = 120;

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

// Construye la lista de tickets de renovación (ventana máxima 120 días, el
// mayor rango que ofrece el selector del heatmap). Ventana, orden y tono se
// calculan los TRES sobre la fecha ACCIONABLE (actionableDaysUntil) — la
// misma que ya usan el calendario y `buildStackStatus` (donut "Estado del
// stack") más abajo. Hasta el 2026-08-06 la ventana/orden usaban días BRUTOS
// (`daysUntil`) deliberadamente, distinto del tono — una discrepancia que la
// agenda por tramos podía tolerar (el filtro solo decidía "entra o no",
// nunca una posición visual) pero que el heatmap no puede: si la columna que
// ocupa un contrato (bucketing semanal, ver buildRenewalHeatmapWeeks) usara
// una fecha distinta a la que decide su color, una celda mentiría sobre su
// propio tono. Se unifica todo en fecha accionable — ver docs/DECISIONS.md.
export function buildRenewalTickets(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  today: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
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

// Nº de columnas del heatmap para una ventana de `windowDays` días. La
// última semana necesaria es la que contiene el día `windowDays` en sí
// (semana k cubre los días accionables [7k, 7k+6]) — floor(windowDays/7)+1,
// no un ceil directo sobre windowDays/7 (coinciden para 120 pero no en
// general). 30/60/90/120 -> 5/9/13/18 columnas.
export function renewalHeatmapWeekCount(windowDays: number): number {
  return Math.floor(windowDays / 7) + 1;
}

// Intensidad de una celda por nº de contratos, 3 escalones discretos (no
// continuo, pedido explícitamente): 1 = low, 2-4 = medium, 5+ = high. 0 no
// tiene intensidad (celda vacía, tratada aparte con su propia clase neutra).
export function weeklyIntensity(count: number): RenewalHeatmapIntensity | null {
  if (count === 0) return null;
  if (count === 1) return "low";
  if (count <= 4) return "medium";
  return "high";
}

// Agrupa tickets ya construidos (`buildRenewalTickets`, ya acotados a
// `windowDays` por fecha accionable) en semanas ROLLING desde `today`
// (semana 0 = días accionables 0-6, semana 1 = 7-13, ...). Un ticket vencido
// o con preaviso ya pasado (actionableDaysUntil negativo) clampa a la semana
// 0 — sigue siendo la más urgente posible, no tiene sentido una columna
// "semana -1". Pura, sin I/O: el selector de rango del cliente recalcula al
// vuelo sobre los tickets ya cargados (máximo 120 días), sin pedir datos
// nuevos al servidor.
export function buildRenewalHeatmapWeeks(
  tickets: RenewalTicket[],
  windowDays: number,
  today: Date = new Date(),
): RenewalHeatmapWeek[] {
  const weekCount = renewalHeatmapWeekCount(windowDays);
  const buckets: RenewalTicket[][] = Array.from({ length: weekCount }, () => []);

  for (const ticket of tickets) {
    if (ticket.actionableDaysUntil > windowDays) continue;
    const index = Math.min(Math.max(0, Math.floor(ticket.actionableDaysUntil / 7)), weekCount - 1);
    buckets[index].push(ticket);
  }

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return buckets.map((weekTickets, index) => ({
    index,
    weekStart: toIsoDate(addDays(start, index * 7)),
    weekEnd: toIsoDate(addDays(start, index * 7 + 6)),
    tickets: weekTickets,
    tone: worstTone(weekTickets.map((t) => t.tone)) ?? "neutral",
    intensity: weeklyIntensity(weekTickets.length),
    totalAnnualCostOrgCurrency: weekTickets.reduce((sum, t) => sum + t.annualCostOrgCurrency, 0),
  }));
}

// Índice de la primera semana (más urgente) con contratos, para preseleccionar
// el panel de detalle por defecto. `weeks` ya viene ordenado por índice
// ascendente, así que basta el primer match. `null` si el rango entero está
// vacío.
export function defaultHeatmapWeekIndex(weeks: RenewalHeatmapWeek[]): number | null {
  return weeks.find((week) => week.tickets.length > 0)?.index ?? null;
}

// Totales de cabecera del RANGO VISIBLE completo (todas las semanas, no solo
// la seleccionada) — responsabilidad separada de
// RenewalHeatmapWeek.totalAnnualCostOrgCurrency, que es por-celda (cabecera
// del panel lateral).
export function summarizeRenewalHeatmap(weeks: RenewalHeatmapWeek[]): {
  contractCount: number;
  totalAnnualCostOrgCurrency: number;
} {
  return weeks.reduce(
    (acc, week) => ({
      contractCount: acc.contractCount + week.tickets.length,
      totalAnnualCostOrgCurrency: acc.totalAnnualCostOrgCurrency + week.totalAnnualCostOrgCurrency,
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
