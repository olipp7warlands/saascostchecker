import type { BillingCycle } from "./types";

export type RenewalTone = "red" | "amber" | "neutral";

// Redondea a días de calendario completos, ignorando la hora del día —
// "hoy" y "mañana" no deben depender de a qué hora se ejecuta esto.
export function daysUntil(dateIso: string, today: Date = new Date()): number {
  const target = new Date(`${dateIso}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((target.getTime() - start.getTime()) / msPerDay);
}

// rojo <=7d, ámbar <=45d, neutro después (criterio de docs/TASKS.md 1.2).
export function renewalTone(days: number): RenewalTone {
  if (days <= 7) return "red";
  if (days <= 45) return "amber";
  return "neutral";
}

// billing_cycle "one_time" se muestra tal cual (no tiene un run-rate anual
// real) — conversión de divisas queda para cuando exista esa infraestructura
// (SPECS §8), esto no convierte moneda.
export function annualizedCost(amount: number, cycle: BillingCycle): number {
  return cycle === "monthly" ? amount * 12 : amount;
}
