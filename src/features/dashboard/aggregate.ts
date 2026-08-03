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
  RenewalAgendaTier,
  RenewalTicket,
  RenewalTierKey,
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
// mayor rango que ofrece el selector de la agenda) — el tono se calcula con
// `renewalTone(daysUntil)` (días BRUTOS hasta renewal_date), a propósito el
// mismo cálculo que ya usaba la pista anterior, NO `actionableDaysUntil`
// (que sí usan el calendario y buildStackStatus más abajo). Unificar esos dos
// criterios sería un cambio de comportamiento de negocio no pedido en el
// rediseño visual de la agenda — queda anotado en docs/DECISIONS.md.
export function buildRenewalTickets(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  today: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): RenewalTicket[] {
  const withinWindow = contracts
    .filter((contract) => contract.status === "active")
    .map((contract) => ({ contract, days: daysUntil(contract.renewalDate, today) }))
    .filter(({ days }) => days <= windowDays)
    .sort((a, b) => a.days - b.days);

  return withinWindow.map(({ contract, days }) => {
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
      tone: renewalTone(days),
      noticeWarning,
      cancellationNoticeDays: contract.cancellationNoticeDays,
    };
  });
}

const TONE_TO_TIER: Record<RenewalTicket["tone"], RenewalTierKey> = {
  red: "critical",
  amber: "upcoming",
  neutral: "stable",
};
const TIER_ORDER: RenewalTierKey[] = ["critical", "upcoming", "stable"];

// Agrupa tickets ya construidos (`buildRenewalTickets`) en los 3 tramos de
// la agenda, acotando además al rango elegido en el selector (30/60/90/120)
// — pura, sin I/O, así el selector de rango del cliente recalcula al vuelo
// sin pedir datos nuevos al servidor (ya se cargó el máximo de 120 días).
// Bucketear por `ticket.tone` (en vez de comparar `daysUntil` a mano contra
// los umbrales) es equivalente: `renewalTone` ya encapsula
// CRITICAL_THRESHOLD_DAYS/WARNING_THRESHOLD_DAYS como única fuente de verdad.
export function groupRenewalTicketsByTier(
  tickets: RenewalTicket[],
  windowDays: number,
): RenewalAgendaTier[] {
  const withinRange = tickets.filter((ticket) => ticket.daysUntil <= windowDays);

  const byTier = new Map<RenewalTierKey, RenewalTicket[]>(TIER_ORDER.map((key) => [key, []]));
  for (const ticket of withinRange) {
    byTier.get(TONE_TO_TIER[ticket.tone])?.push(ticket);
  }

  return TIER_ORDER.map((key) => {
    const tierTickets = byTier.get(key) ?? [];
    return {
      key,
      tickets: tierTickets,
      totalAnnualCostOrgCurrency: tierTickets.reduce((sum, t) => sum + t.annualCostOrgCurrency, 0),
    };
  });
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
