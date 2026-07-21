import type { BudgetTone } from "./thresholds";

export type Budget = {
  id: string;
  companyId: string | null;
  departmentId: string | null;
  fiscalYear: number;
  amount: number;
  currency: string;
};

// Solo los campos que necesita la atribución de gasto — no el shape
// completo de DashboardContract (aggregate.ts vive en otro dominio).
export type BudgetActiveContract = {
  vendorId: string;
  companyId: string | null;
  departmentId: string | null;
};

export type BudgetSpendRecord = {
  vendorId: string;
  amount: number;
  currency: string;
  date: string; // "YYYY-MM-DD"
};

export type BudgetBucketVendor = {
  vendorId: string;
  amount: number;
};

export type BudgetBucket = {
  // budgetId cuando hay bolsa creada; si no, una clave sintética por scope
  // real (empresa, departamento) para no mezclar gasto sin presupuesto de
  // distintos departamentos/empresas en un único cajón "sin asignar".
  key: string;
  budgetId: string | null;
  companyId: string | null;
  departmentId: string | null;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  consumedAmount: number;
  projectedYearEnd: number | null;
  tone: BudgetTone | null;
  vendors: BudgetBucketVendor[];
};
