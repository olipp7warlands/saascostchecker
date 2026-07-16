import { actionableDaysUntil } from "./renewal";

export type PrimaryAction =
  | { type: "addContract" }
  | { type: "renegotiate"; contractId: string }
  | { type: "edit" };

type ContractForAction = {
  id: string;
  status: string; // "active" | "cancelled"
  renewalDate: string; // ISO date, e.g. "2026-08-01"
  autoRenews: boolean;
  cancellationNoticeDays: number;
};

const CRITICAL_THRESHOLD_DAYS = 7;

// Decide la única acción "primaria" a mostrar en la cabecera de la página de
// un vendor: renegociar el contrato más urgente si alguno está a punto de
// bloquearse en auto-renovación (o de vencer), añadir el primer contrato si
// no hay ninguno activo, o editar como caso por defecto/tranquilo.
export function pickPrimaryAction(
  contracts: ContractForAction[],
  today: Date = new Date(),
): PrimaryAction {
  const active = contracts.filter((c) => c.status === "active");
  if (active.length === 0) {
    return { type: "addContract" };
  }

  let mostCritical: { contractId: string; actionableDays: number } | null = null;
  for (const contract of active) {
    const actionableDays = actionableDaysUntil(
      contract.renewalDate,
      contract.autoRenews,
      contract.cancellationNoticeDays,
      today,
    );
    if (
      actionableDays <= CRITICAL_THRESHOLD_DAYS &&
      (mostCritical === null || actionableDays < mostCritical.actionableDays)
    ) {
      mostCritical = { contractId: contract.id, actionableDays };
    }
  }

  if (mostCritical) {
    return { type: "renegotiate", contractId: mostCritical.contractId };
  }
  return { type: "edit" };
}
