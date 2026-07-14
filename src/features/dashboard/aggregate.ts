import { annualizedCost, daysUntil, renewalTone } from "@/features/vendors/renewal";
import { wastedSeatCost } from "@/features/vendors/seats";
import { convertAmount } from "./currency";
import type {
  DashboardContract,
  DashboardKpis,
  DashboardVendor,
  DepartmentSpendRow,
  ExchangeRate,
  RenewalTicket,
} from "./types";

const RENEWAL_WINDOW_DAYS = 120;
// Distancia mínima en % del eje (0-100) entre dos tickets para no
// considerarlos solapados — mismo criterio visual que los `top:6px/60px`
// alternos del mockup, aquí resuelto con 2 carriles en vez de offsets fijos.
const LANE_COLLISION_PCT = 6;

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

export function buildRenewalTrack(
  contracts: DashboardContract[],
  today: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): RenewalTicket[] {
  const withinWindow = contracts
    .filter((contract) => contract.status === "active")
    .map((contract) => ({ contract, days: daysUntil(contract.renewalDate, today) }))
    .filter(({ days }) => days <= windowDays)
    .sort((a, b) => a.days - b.days);

  const laneLastX: [number, number] = [-Infinity, -Infinity];

  return withinWindow.map(({ contract, days }) => {
    // Vencidos (días negativos) se muestran clamped al extremo izquierdo en
    // vez de ocultarse — un contrato ya vencido sigue siendo información
    // real y accionable.
    const xPercent = Math.min((Math.max(days, 0) / windowDays) * 100, 100);
    const lane: 0 | 1 = xPercent - laneLastX[0] >= LANE_COLLISION_PCT ? 0 : 1;
    laneLastX[lane] = xPercent;

    const noticeWarning =
      contract.autoRenews &&
      contract.cancellationNoticeDays > 0 &&
      days <= contract.cancellationNoticeDays;

    return {
      contractId: contract.id,
      vendorId: contract.vendorId,
      vendorName: contract.vendorName,
      vendorWebsite: contract.vendorWebsite,
      annualCost: annualizedCost(contract.costAmount, contract.billingCycle),
      currency: contract.currency,
      daysUntil: days,
      tone: renewalTone(days),
      xPercent,
      lane,
      noticeWarning,
      cancellationNoticeDays: contract.cancellationNoticeDays,
    };
  });
}

const UNASSIGNED_KEY = "__unassigned__";

export function buildDepartmentSpend(
  contracts: DashboardContract[],
  orgCurrency: string,
  rates: ExchangeRate[],
  unassignedLabel: string,
): DepartmentSpendRow[] {
  const rows = new Map<string, { name: string; spend: number; vendorIds: Set<string> }>();

  for (const contract of contracts) {
    if (contract.status !== "active") {
      continue;
    }

    const key = contract.departmentId ?? UNASSIGNED_KEY;
    const name = contract.departmentId ? (contract.departmentName ?? "") : unassignedLabel;
    const annual = annualizedCost(contract.costAmount, contract.billingCycle);
    const converted = convertAmount(annual, contract.currency, orgCurrency, rates);

    const row = rows.get(key) ?? { name, spend: 0, vendorIds: new Set<string>() };
    row.spend += converted;
    row.vendorIds.add(contract.vendorId);
    rows.set(key, row);
  }

  return [...rows.entries()]
    .map(([key, row]) => ({
      departmentId: key === UNASSIGNED_KEY ? null : key,
      departmentName: row.name,
      annualizedSpend: row.spend,
      vendorCount: row.vendorIds.size,
    }))
    .sort((a, b) => b.annualizedSpend - a.annualizedSpend);
}
