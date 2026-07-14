import type { ExchangeRate } from "./types";

// Conversión a la moneda default de la org usando `exchange_rates` (dato
// estático/manual, ver docs/DECISIONS.md bloque 1.5 — sin API de terceros
// hasta Fase 5). Sin rate disponible (ni directo ni inverso), el importe se
// deja sin convertir en vez de fallar: una moneda sin sembrar no debe tirar
// el dashboard entero, solo produce un agregado ligeramente subestimado si
// las divisas no coinciden — degradación explícita, no silenciosa (se
// documenta aquí, no se aparenta precisión que no hay).
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: ExchangeRate[],
): number {
  if (from === to) {
    return amount;
  }

  const direct = rates.find((rate) => rate.baseCurrency === from && rate.quoteCurrency === to);
  if (direct) {
    return amount * direct.rate;
  }

  const inverse = rates.find((rate) => rate.baseCurrency === to && rate.quoteCurrency === from);
  if (inverse) {
    return amount / inverse.rate;
  }

  return amount;
}
