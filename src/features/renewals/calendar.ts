import type { DashboardContract } from "@/features/dashboard/types";
import { actionableDaysUntil, renewalTone, type RenewalTone } from "@/features/vendors/renewal";

const DAYS_IN_GRID = 42; // 6 semanas x 7 días — siempre cubre el mes completo.

export type CalendarMarker = {
  contractId: string;
  vendorId: string;
  vendorName: string;
  tone: RenewalTone;
  kind: "actionable" | "informational";
};

export type CalendarDay = {
  date: string; // "YYYY-MM-DD"
  isCurrentMonth: boolean;
  markers: CalendarMarker[];
};

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Rejilla de 42 días con lunes fijo como primer día de semana, independiente
// del locale (decisión confirmada — ver docs/DECISIONS.md).
function buildMonthGridStart(year: number, month: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7; // getDay(): 0=domingo..6=sábado
  return addDays(firstOfMonth, -mondayOffset);
}

// Bucketing de contratos por día del calendario para el mes (year, month
// 0-indexado, convención de Date). Marcador primario ("actionable") en la
// fecha en que la decisión de renovación deja de ser accionable (mismo
// criterio que primary-action.ts/renewal-track.tsx vía actionableDaysUntil);
// marcador secundario ("informational", tono siempre neutro) en la fecha de
// renovación bruta, solo cuando difiere de la accionable. Contratos
// cancelados quedan excluidos. Sin filtrado por empresa/departamento/
// auto-renovación — responsabilidad del componente cliente sobre la lista de
// contratos de entrada.
export function buildCalendarMonth(
  contracts: DashboardContract[],
  year: number,
  month: number,
  today: Date = new Date(),
): CalendarDay[] {
  const markersByDate = new Map<string, CalendarMarker[]>();

  const pushMarker = (dateIso: string, marker: CalendarMarker) => {
    const existing = markersByDate.get(dateIso);
    if (existing) {
      existing.push(marker);
    } else {
      markersByDate.set(dateIso, [marker]);
    }
  };

  for (const contract of contracts) {
    if (contract.status === "cancelled") continue;

    const renewalDate = parseIsoDate(contract.renewalDate);
    const actionableDate = contract.autoRenews
      ? addDays(renewalDate, -contract.cancellationNoticeDays)
      : renewalDate;
    const actionableIso = toIsoDate(actionableDate);
    const renewalIso = toIsoDate(renewalDate);

    const tone = renewalTone(
      actionableDaysUntil(
        contract.renewalDate,
        contract.autoRenews,
        contract.cancellationNoticeDays,
        today,
      ),
    );

    pushMarker(actionableIso, {
      contractId: contract.id,
      vendorId: contract.vendorId,
      vendorName: contract.vendorName,
      tone,
      kind: "actionable",
    });

    if (renewalIso !== actionableIso) {
      pushMarker(renewalIso, {
        contractId: contract.id,
        vendorId: contract.vendorId,
        vendorName: contract.vendorName,
        tone: "neutral",
        kind: "informational",
      });
    }
  }

  const gridStart = buildMonthGridStart(year, month);
  const days: CalendarDay[] = [];
  for (let i = 0; i < DAYS_IN_GRID; i++) {
    const date = addDays(gridStart, i);
    const dateIso = toIsoDate(date);
    days.push({
      date: dateIso,
      isCurrentMonth: date.getFullYear() === year && date.getMonth() === month,
      markers: (markersByDate.get(dateIso) ?? [])
        .slice()
        .sort((a, b) => (a.kind === b.kind ? a.vendorName.localeCompare(b.vendorName) : a.kind === "actionable" ? -1 : 1)),
    });
  }

  return days;
}
