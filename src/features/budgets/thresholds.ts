export type BudgetTone = "critical" | "upcoming" | "stable";

// Umbrales del semáforo de presupuesto (dominio propio, no se mezclan con
// CRITICAL_THRESHOLD_DAYS/WARNING_THRESHOLD_DAYS de renewal.ts aunque
// compartan el mismo patrón de "constantes con nombre, un único sitio").
// Métrica: ritmo de consumo = % del presupuesto consumido ÷ % del año
// fiscal transcurrido. 1.0 = gastando exactamente al ritmo del calendario.
export const BUDGET_STABLE_PACE_RATIO = 1.05;
export const BUDGET_WARNING_PACE_RATIO = 1.25;

// Un presupuesto ya agotado (>=100% consumido) es siempre crítico,
// independientemente del ritmo — no tiene sentido decir "estable" de una
// bolsa que ya no tiene fondos.
export function budgetTone(consumedAmount: number, budgetAmount: number, elapsedPct: number): BudgetTone {
  if (budgetAmount <= 0) {
    return consumedAmount > 0 ? "critical" : "stable";
  }

  const consumedPct = consumedAmount / budgetAmount;
  if (consumedPct >= 1) {
    return "critical";
  }

  if (elapsedPct <= 0) {
    return consumedPct > 0 ? "critical" : "stable";
  }

  const paceRatio = consumedPct / elapsedPct;
  if (paceRatio <= BUDGET_STABLE_PACE_RATIO) {
    return "stable";
  }
  if (paceRatio <= BUDGET_WARNING_PACE_RATIO) {
    return "upcoming";
  }
  return "critical";
}
