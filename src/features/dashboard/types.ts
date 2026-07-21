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
  companyId: string | null;
  companyName: string | null;
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

export type CompanySpendRow = {
  companyId: string | null;
  companyName: string;
  annualizedSpend: number;
  vendorCount: number;
};

// Fila normalizada que consume el chart de barras — mismo shape para
// departamento y empresa, así el componente no necesita conocer cuál de los
// dos agrupamientos está mostrando.
export type SpendGroupRow = {
  groupId: string | null;
  groupName: string;
  annualizedSpend: number;
  vendorCount: number;
};

export type StackStatusBucket = "critical" | "upcoming" | "stable" | "noContract";

export type StackStatusSummary = {
  critical: number;
  upcoming: number;
  stable: number;
  noContract: number;
  total: number;
};

export type MonthlySpendPoint = {
  month: string; // "YYYY-MM"
  amount: number;
};

export type MonthlySpendSeries = {
  points: MonthlySpendPoint[];
  monthsWithData: number;
};

export type MonthlySpendRow = {
  month: string; // "YYYY-MM-01" (date_trunc del mes), tal como devuelve la RPC
  currency: string;
  total: number;
};

export type ReconciliationPreviewRow = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  rawDescription: string;
  suggestedName: string | null;
};

// Fila de savings_records ya en la moneda de la org (guardada así en el
// momento de capturar el ahorro, no reconvertida al leer — ver docs/DECISIONS.md).
export type SavingsRecord = {
  id: string;
  vendorId: string | null;
  vendorName: string;
  kind: "renegotiated" | "cancelled";
  savingsAmount: number;
  closedAt: string; // "YYYY-MM-DD"
};
