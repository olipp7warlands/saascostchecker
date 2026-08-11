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
  // Coste anualizado convertido a la moneda default de la org — para sumar
  // por semana/celda del heatmap; las filas del panel siguen mostrando
  // `annualCost` en la moneda nativa del contrato (sin cambios visibles).
  annualCostOrgCurrency: number;
  daysUntil: number;
  // Días hasta la fecha ACCIONABLE (actionableDaysUntil) — preaviso de
  // cancelación si el contrato auto-renueva, la propia fecha de renovación
  // si no. Fuente única de verdad del heatmap: decide en qué semana/celda
  // cae el ticket, su tono, y la cifra principal mostrada en el panel (ver
  // renewal-heatmap.tsx); `daysUntil` (bruto) se conserva solo para el caso
  // "vencido" y el mensaje de preaviso.
  actionableDaysUntil: number;
  tone: RenewalTone;
  noticeWarning: boolean;
  cancellationNoticeDays: number;
};

export type RenewalHeatmapIntensity = "low" | "medium" | "high";

// Una celda del heatmap = un día de calendario. `isPadding` = relleno fuera
// de la ventana visible solicitada (semana parcial inicial/final del
// trimestre navegado) — no interactivo, nunca tiene tickets. `tone`/
// `intensity` resumen la celda para pintarla; `tickets` alimenta el panel de
// detalle al seleccionar el día.
export type RenewalHeatmapDay = {
  date: string; // "YYYY-MM-DD"
  isPadding: boolean;
  tickets: RenewalTicket[];
  tone: RenewalTone;
  intensity: RenewalHeatmapIntensity | null; // null = celda vacía, fuera de la escala
};

// Etiqueta de mes sobre una columna (semana) del grid. `showYear` es true
// solo para los meses que se repiten dentro del horizonte de 12 meses (en la
// práctica, el mes de arranque — aparece en la columna 0 y de nuevo ~52
// columnas después con año distinto) — desambigua sin ensuciar el resto de
// etiquetas.
export type RenewalHeatmapMonthLabel = {
  columnIndex: number;
  year: number;
  month: number; // 0-indexado, convención Date
  showYear: boolean;
};

// `days` es un array plano en orden CRONOLÓGICO, longitud weekCount*7 (lunes
// semana 0, martes semana 0, ..., domingo semana 0, lunes semana 1, ...) —
// pensado para pintarse con CSS `grid-auto-flow: column` (ver
// renewal-heatmap.tsx), no pre-agrupado en columnas.
export type RenewalHeatmapGrid = {
  weekCount: number;
  days: RenewalHeatmapDay[];
  monthLabels: RenewalHeatmapMonthLabel[];
};

// Los 3 niveles de granularidad "grandes" (semana/mes/año, v3.2) comparten
// forma: una celda = un periodo de calendario, resumida con el mismo criterio
// que RenewalHeatmapDay (tono = peor urgencia, intensidad = nº contratos,
// más el coste anual acumulado de la celda para la cabecera del panel).
export type RenewalHeatmapWeek = {
  weekStart: string; // "YYYY-MM-DD" (lunes)
  weekEnd: string; // "YYYY-MM-DD" (domingo)
  tickets: RenewalTicket[];
  tone: RenewalTone;
  intensity: RenewalHeatmapIntensity | null;
  totalAnnualCostOrgCurrency: number;
};

export type RenewalHeatmapMonth = {
  year: number;
  month: number; // 0-indexado, convención Date
  tickets: RenewalTicket[];
  tone: RenewalTone;
  intensity: RenewalHeatmapIntensity | null;
  totalAnnualCostOrgCurrency: number;
};

// Sin ventana navegable: incluye todo año con ≥1 contrato entre los tickets
// ya cargados (conjunto acotado por los propios contratos activos, no por un
// rango de fechas — ver buildRenewalHeatmapYears).
export type RenewalHeatmapYear = {
  year: number;
  tickets: RenewalTicket[];
  tone: RenewalTone;
  intensity: RenewalHeatmapIntensity | null;
  totalAnnualCostOrgCurrency: number;
};

export type RenewalHeatmapGranularity = "day" | "week" | "month" | "year";

// Selección activa del panel de detalle, una por nivel de granularidad.
// Default de cada nivel: el periodo más urgente con contenido de la ventana
// visible (ver firstRenewalHeatmapCellWithTickets en aggregate.ts).
export type RenewalHeatmapSelection =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; year: number; month: number }
  | { kind: "year"; year: number };

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
