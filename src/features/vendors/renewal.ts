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

// Días hasta que la decisión de renovación deja de ser accionable: si el
// contrato auto-renueva, el deadline real es el preaviso de cancelación
// (pasado ese punto ya quedó bloqueado en auto-renovación), no la fecha de
// renovación en sí. Fuente única de verdad compartida entre el "primario
// contextual" de la cabecera (primary-action.ts) y el resaltado en rojo de
// la tarjeta de renovación (vendor-rail.tsx) — antes cada uno calculaba la
// urgencia por su cuenta y quedaban inconsistentes entre sí.
export function actionableDaysUntil(
  renewalDateIso: string,
  autoRenews: boolean,
  cancellationNoticeDays: number,
  today: Date = new Date(),
): number {
  const days = daysUntil(renewalDateIso, today);
  return autoRenews ? days - cancellationNoticeDays : days;
}
