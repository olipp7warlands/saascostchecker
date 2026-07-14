import type { RenewalTone } from "@/features/vendors/renewal";
import type { BillingCycle, ContractStatus, VendorStatus } from "@/features/vendors/types";

export type ExchangeRate = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
};

// Fila plana usada por las 3 funciones de agregación — una sola forma para
// no reconstruir el shape en cada consumidor (KPIs, pista de renovaciones,
// gasto por departamento leen todas de la misma query anidada).
export type DashboardContract = {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorWebsite: string;
  costAmount: number;
  currency: string;
  billingCycle: BillingCycle;
  seatsPurchased: number | null;
  activeSeats: number;
  renewalDate: string;
  autoRenews: boolean;
  cancellationNoticeDays: number;
  status: ContractStatus;
  departmentId: string | null;
  departmentName: string | null;
};

export type DashboardVendor = {
  id: string;
  status: VendorStatus;
  ownerUserId: string | null;
};

export type DashboardKpis = {
  annualizedSpend: number;
  activeContractCount: number;
  currencyCount: number;
  activeVendorCount: number;
  vendorsWithoutOwnerCount: number;
  wastedLicenseCost: number;
  idleSeatCount: number;
  renewalsNext90: number;
  renewalsNext30: number;
};

export type RenewalTicket = {
  contractId: string;
  vendorId: string;
  vendorName: string;
  vendorWebsite: string;
  annualCost: number;
  currency: string;
  daysUntil: number;
  tone: RenewalTone;
  xPercent: number;
  lane: 0 | 1;
  noticeWarning: boolean;
  cancellationNoticeDays: number;
};

export type DepartmentSpendRow = {
  departmentId: string | null;
  departmentName: string;
  annualizedSpend: number;
  vendorCount: number;
};

export type ReconciliationPreviewRow = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  rawDescription: string;
  suggestedName: string | null;
};
