import { describe, expect, it } from "vitest";
import type { ExchangeRate } from "@/features/dashboard/types";
import { buildBudgetConsumption, resolveBudget } from "./aggregate";
import type { Budget, BudgetActiveContract, BudgetSpendRecord } from "./types";

const DEPT_ENG = "dept-eng";
const DEPT_SALES = "dept-sales";
const CO_MAIN = "co-main";
const CO_SUB = "co-sub";

describe("resolveBudget", () => {
  const budgets: Budget[] = [
    { id: "exact", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 100, currency: "EUR" },
    { id: "dept-only", companyId: null, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 200, currency: "EUR" },
    { id: "company-only", companyId: CO_MAIN, departmentId: null, fiscalYear: 2026, amount: 300, currency: "EUR" },
  ];

  it("prioriza la bolsa exacta (empresa + departamento) sobre las parciales", () => {
    expect(resolveBudget(CO_MAIN, DEPT_ENG, budgets)?.id).toBe("exact");
  });

  it("cae a la bolsa de departamento (todas las empresas) si no hay exacta", () => {
    expect(resolveBudget(CO_SUB, DEPT_ENG, budgets)?.id).toBe("dept-only");
  });

  it("cae a la bolsa de empresa entera si no hay de departamento", () => {
    expect(resolveBudget(CO_MAIN, DEPT_SALES, budgets)?.id).toBe("company-only");
  });

  it("no resuelve ninguna bolsa si nada coincide", () => {
    expect(resolveBudget(CO_SUB, DEPT_SALES, budgets)).toBeNull();
  });

  it("nunca hace doble match: una vez resuelta la más específica, no se buscan las demás", () => {
    // company-only(CO_MAIN) y dept-only(DEPT_ENG) ambas podrían aplicar a
    // (CO_MAIN, DEPT_ENG), pero "exact" debe ganar sola.
    const resolved = resolveBudget(CO_MAIN, DEPT_ENG, budgets);
    expect(resolved?.id).toBe("exact");
  });
});

describe("buildBudgetConsumption", () => {
  const rates: ExchangeRate[] = [{ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.9 }];

  it("atribuye el gasto reconciliado del año a la bolsa que le corresponde", () => {
    const budgets: Budget[] = [
      { id: "b1", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 1000, currency: "EUR" },
    ];
    const contracts: BudgetActiveContract[] = [
      { vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG },
    ];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 200, currency: "EUR", date: "2026-03-01" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, budgets, "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].budgetId).toBe("b1");
    expect(buckets[0].consumedAmount).toBe(200);
    expect(buckets[0].vendors).toEqual([{ vendorId: "v1", amount: 200 }]);
  });

  it("un gasto sin ninguna bolsa que le corresponda cae en un cajón 'sin presupuesto' propio de su scope real", () => {
    const contracts: BudgetActiveContract[] = [
      { vendorId: "v1", companyId: CO_SUB, departmentId: DEPT_SALES },
    ];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 150, currency: "EUR", date: "2026-01-15" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].budgetId).toBeNull();
    expect(buckets[0].budgetAmount).toBeNull();
    expect(buckets[0].tone).toBeNull();
    expect(buckets[0].consumedAmount).toBe(150);
    expect(buckets[0].companyId).toBe(CO_SUB);
    expect(buckets[0].departmentId).toBe(DEPT_SALES);
  });

  it("un vendor sin ningún contrato activo cae en el scope null/null, sin perder el gasto", () => {
    const records: BudgetSpendRecord[] = [
      { vendorId: "orphan", amount: 80, currency: "EUR", date: "2026-01-15" },
    ];
    const buckets = buildBudgetConsumption(records, [], [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].companyId).toBeNull();
    expect(buckets[0].departmentId).toBeNull();
    expect(buckets[0].consumedAmount).toBe(80);
  });

  it("reparte a partes iguales el gasto de un vendor con contratos activos en 2 scopes distintos", () => {
    const contracts: BudgetActiveContract[] = [
      { vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG },
      { vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_SALES },
    ];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 300, currency: "EUR", date: "2026-02-01" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(2);
    const total = buckets.reduce((sum, b) => sum + b.consumedAmount, 0);
    expect(total).toBe(300); // la suma nunca duplica ni pierde dinero
    expect(buckets.every((b) => b.consumedAmount === 150)).toBe(true);
  });

  it("un vendor con 2 contratos activos que comparten el mismo scope no duplica el reparto", () => {
    const contracts: BudgetActiveContract[] = [
      { vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG },
      { vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG },
    ];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 300, currency: "EUR", date: "2026-02-01" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].consumedAmount).toBe(300);
  });

  it("convierte a la moneda de la org antes de acumular", () => {
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: null }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 100, currency: "USD", date: "2026-01-10" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets[0].consumedAmount).toBe(90); // 100 USD * 0.9
  });

  it("descarta spend_records fuera del año fiscal consultado", () => {
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: null }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 100, currency: "EUR", date: "2025-12-31" },
      { vendorId: "v1", amount: 50, currency: "EUR", date: "2027-01-01" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(0);
  });

  it("una bolsa presupuestada sin ningún gasto todavía sigue siendo visible con 0 consumido", () => {
    const budgets: Budget[] = [
      { id: "b1", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 500, currency: "EUR" },
    ];
    const buckets = buildBudgetConsumption([], [], budgets, "EUR", rates, 2026, new Date(2026, 5, 1));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].consumedAmount).toBe(0);
    expect(buckets[0].tone).toBe("stable");
  });

  it("proyecta el fin de año (run-rate) solo para el año en curso, año parcial", () => {
    const budgets: Budget[] = [
      { id: "b1", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 10000, currency: "EUR" },
    ];
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 1000, currency: "EUR", date: "2026-02-15" },
    ];
    // 2026-04-11 = día 101 del año (año no bisiesto, 365 días).
    const today = new Date(2026, 3, 11);

    const buckets = buildBudgetConsumption(records, contracts, budgets, "EUR", rates, 2026, today);
    expect(buckets[0].consumedAmount).toBe(1000);
    expect(buckets[0].projectedYearEnd).toBeCloseTo((1000 / 101) * 365, 5);
  });

  it("no proyecta un año fiscal ya cerrado (pasado)", () => {
    const budgets: Budget[] = [
      { id: "b1", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2025, amount: 10000, currency: "EUR" },
    ];
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 1000, currency: "EUR", date: "2025-06-01" },
    ];

    const buckets = buildBudgetConsumption(records, contracts, budgets, "EUR", rates, 2025, new Date(2026, 3, 11));
    expect(buckets[0].projectedYearEnd).toBeNull();
    // Año ya cerrado: el tono se calcula sobre el ritmo final real (100%
    // transcurrido), no queda indefinido.
    expect(buckets[0].tone).toBe("stable");
  });

  it("no proyecta un año fiscal todavía futuro", () => {
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: null }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 10, currency: "EUR", date: "2027-01-05" },
    ];
    const buckets = buildBudgetConsumption(records, contracts, [], "EUR", rates, 2027, new Date(2026, 3, 11));
    expect(buckets[0].projectedYearEnd).toBeNull();
  });

  it("un consumo por encima del 100% del presupuesto es siempre crítico, aunque vaya poco avanzado el año", () => {
    const budgets: Budget[] = [
      { id: "b1", companyId: CO_MAIN, departmentId: DEPT_ENG, fiscalYear: 2026, amount: 100, currency: "EUR" },
    ];
    const contracts: BudgetActiveContract[] = [{ vendorId: "v1", companyId: CO_MAIN, departmentId: DEPT_ENG }];
    const records: BudgetSpendRecord[] = [
      { vendorId: "v1", amount: 150, currency: "EUR", date: "2026-01-05" },
    ];
    // 5 de enero: apenas ha empezado el año.
    const buckets = buildBudgetConsumption(records, contracts, budgets, "EUR", rates, 2026, new Date(2026, 0, 5));
    expect(buckets[0].tone).toBe("critical");
  });
});
