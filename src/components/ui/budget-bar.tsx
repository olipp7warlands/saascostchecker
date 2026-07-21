import { cn } from "@/lib/utils";
import type { BudgetTone } from "@/features/budgets/thresholds";

// Mismos 3 tonos que el resto de la app (rojo/ámbar/verde para
// crítico/próximo/estable), pista más ancha que UtilizationBar (90px) porque
// aquí la barra es el contenido principal de cada fila, no un adorno junto a
// una cifra.
const FILL_CLASSES: Record<BudgetTone, string> = {
  critical: "bg-destructive",
  upcoming: "bg-warning",
  stable: "bg-success",
};

export function BudgetBar({
  pct,
  tone,
  className,
}: {
  pct: number;
  tone: BudgetTone | null;
  className?: string;
}) {
  const width = Math.min(Math.max(pct, 0), 100);

  return (
    <span className={cn("inline-block h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <span
        className={cn("block h-full rounded-full", tone ? FILL_CLASSES[tone] : "bg-ink-soft/40")}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
