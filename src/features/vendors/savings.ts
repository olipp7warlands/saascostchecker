import type { ExchangeRate } from "@/features/dashboard/types";
import { convertAmount } from "@/features/dashboard/currency";
import { annualizedCost } from "./renewal";
import type { BillingCycle } from "./types";

export type SavingsComputation = {
  previousAnnualCost: number;
  newAnnualCost: number;
  savingsAmount: number;
};

// Sugerencia de ahorro para los diálogos de renegociar/cancelar — reusa
// annualizedCost()+convertAmount(), ya existentes y testeados, en vez de
// reimplementar la conversión de divisa en PL/pgSQL. El resultado es
// editable por el usuario antes de enviarlo al RPC (§e del diseño de 2.3b).
export function computeSavings(
  previousAmount: number,
  previousCycle: BillingCycle,
  previousCurrency: string,
  newAmount: number,
  newCycle: BillingCycle,
  newCurrency: string,
  orgCurrency: string,
  rates: ExchangeRate[],
): SavingsComputation {
  const previousAnnualCost = convertAmount(
    annualizedCost(previousAmount, previousCycle),
    previousCurrency,
    orgCurrency,
    rates,
  );
  const newAnnualCost = convertAmount(
    annualizedCost(newAmount, newCycle),
    newCurrency,
    orgCurrency,
    rates,
  );

  return {
    previousAnnualCost,
    newAnnualCost,
    savingsAmount: previousAnnualCost - newAnnualCost,
  };
}
