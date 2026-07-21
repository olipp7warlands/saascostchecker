import { convertAmount } from "@/features/dashboard/currency";
import type { ExchangeRate } from "@/features/dashboard/types";
import { budgetTone } from "./thresholds";
import type { Budget, BudgetActiveContract, BudgetBucket, BudgetSpendRecord } from "./types";

const NIL = "__none__";

function scopeKey(companyId: string | null, departmentId: string | null): string {
  return `${companyId ?? NIL}::${departmentId ?? NIL}`;
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

function dayOfYear(date: Date, year: number): number {
  const start = new Date(year, 0, 1);
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((current.getTime() - start.getTime()) / msPerDay) + 1;
}

// Precedencia por especificidad, resuelta contra UNA sola bolsa (nunca se
// suma el mismo gasto contra dos bolsas a la vez, ver docs/DECISIONS.md):
// (empresa, departamento) exacta > departamento para todas las empresas >
// empresa entera sin desglose > sin presupuesto.
export function resolveBudget(
  companyId: string | null,
  departmentId: string | null,
  budgets: Budget[],
): Budget | null {
  if (companyId != null && departmentId != null) {
    const exact = budgets.find((b) => b.companyId === companyId && b.departmentId === departmentId);
    if (exact) return exact;
  }
  if (departmentId != null) {
    const deptOnly = budgets.find((b) => b.companyId === null && b.departmentId === departmentId);
    if (deptOnly) return deptOnly;
  }
  if (companyId != null) {
    const companyOnly = budgets.find((b) => b.departmentId === null && b.companyId === companyId);
    if (companyOnly) return companyOnly;
  }
  return null;
}

// Atribuye spend_records reconciliados (vendor_id is not null, mismo
// dataset/definición que dashboard_monthly_spend()) a bolsas de presupuesto
// departamento x empresa x año fiscal. Un vendor sin contrato activo, o un
// spend_record de un año distinto a fiscalYear, no consume ninguna bolsa de
// ese año.
//
// Reparto cuando un vendor tiene contratos activos en varios departamentos/
// empresas distintos a la vez (posible con el modelo actual, no hay
// contract_id en spend_records para desambiguar): el importe se reparte a
// partes iguales entre esos scopes distintos, para que la suma total
// atribuida siga cuadrando exactamente con el gasto real — ver
// docs/DECISIONS.md, simplificación documentada, no un bug.
export function buildBudgetConsumption(
  spendRecords: BudgetSpendRecord[],
  activeContracts: BudgetActiveContract[],
  budgets: Budget[],
  orgCurrency: string,
  rates: ExchangeRate[],
  fiscalYear: number,
  today: Date = new Date(),
): BudgetBucket[] {
  const yearBudgets = budgets.filter((budget) => budget.fiscalYear === fiscalYear);

  const scopesByVendor = new Map<string, { companyId: string | null; departmentId: string | null }[]>();
  for (const contract of activeContracts) {
    const scopes = scopesByVendor.get(contract.vendorId) ?? [];
    const key = scopeKey(contract.companyId, contract.departmentId);
    if (!scopes.some((scope) => scopeKey(scope.companyId, scope.departmentId) === key)) {
      scopes.push({ companyId: contract.companyId, departmentId: contract.departmentId });
    }
    scopesByVendor.set(contract.vendorId, scopes);
  }

  const buckets = new Map<string, BudgetBucket>();
  const vendorAmounts = new Map<string, Map<string, number>>();

  function addToBucket(
    bucketKey: string,
    budget: Budget | null,
    scope: { companyId: string | null; departmentId: string | null },
    vendorId: string,
    share: number,
  ) {
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.consumedAmount += share;
    } else {
      buckets.set(bucketKey, {
        key: bucketKey,
        budgetId: budget?.id ?? null,
        companyId: scope.companyId,
        departmentId: scope.departmentId,
        budgetAmount: budget?.amount ?? null,
        budgetCurrency: budget?.currency ?? null,
        consumedAmount: share,
        projectedYearEnd: null,
        tone: null,
        vendors: [],
      });
    }

    const vendorMap = vendorAmounts.get(bucketKey) ?? new Map<string, number>();
    vendorMap.set(vendorId, (vendorMap.get(vendorId) ?? 0) + share);
    vendorAmounts.set(bucketKey, vendorMap);
  }

  const yearPrefix = String(fiscalYear);
  for (const record of spendRecords) {
    if (!record.date.startsWith(yearPrefix)) {
      continue;
    }

    const converted = convertAmount(record.amount, record.currency, orgCurrency, rates);
    const scopes = scopesByVendor.get(record.vendorId) ?? [{ companyId: null, departmentId: null }];
    const share = converted / scopes.length;

    for (const scope of scopes) {
      const budget = resolveBudget(scope.companyId, scope.departmentId, yearBudgets);
      const bucketKey = budget ? budget.id : `scope:${scopeKey(scope.companyId, scope.departmentId)}`;
      addToBucket(bucketKey, budget, scope, record.vendorId, share);
    }
  }

  // Una bolsa presupuestada sin ningún gasto todavía sigue siendo visible
  // (0% consumido es dato real, no "no existe") — mismo criterio que el
  // resto del proyecto de no ocultar información.
  for (const budget of yearBudgets) {
    if (!buckets.has(budget.id)) {
      buckets.set(budget.id, {
        key: budget.id,
        budgetId: budget.id,
        companyId: budget.companyId,
        departmentId: budget.departmentId,
        budgetAmount: budget.amount,
        budgetCurrency: budget.currency,
        consumedAmount: 0,
        projectedYearEnd: null,
        tone: null,
        vendors: [],
      });
    }
  }

  const currentYear = today.getFullYear();
  const totalDays = daysInYear(fiscalYear);
  const elapsedDays =
    fiscalYear === currentYear
      ? Math.max(dayOfYear(today, fiscalYear), 1)
      : fiscalYear < currentYear
        ? totalDays
        : 0;
  const elapsedPct = elapsedDays / totalDays;

  for (const bucket of buckets.values()) {
    bucket.vendors = [...(vendorAmounts.get(bucket.key)?.entries() ?? [])]
      .map(([vendorId, amount]) => ({ vendorId, amount }))
      .sort((a, b) => b.amount - a.amount);

    // La proyección de fin de año solo tiene sentido para el año en curso —
    // un año ya cerrado o todavía futuro no se proyecta.
    if (fiscalYear === currentYear && elapsedDays > 0) {
      bucket.projectedYearEnd = (bucket.consumedAmount / elapsedDays) * totalDays;
    }

    if (bucket.budgetAmount != null) {
      bucket.tone = budgetTone(bucket.consumedAmount, bucket.budgetAmount, elapsedPct);
    }
  }

  return [...buckets.values()].sort((a, b) => b.consumedAmount - a.consumedAmount);
}
