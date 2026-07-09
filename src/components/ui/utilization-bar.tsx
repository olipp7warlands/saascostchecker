import { cn } from "@/lib/utils";
import type { UtilizationTone } from "@/features/vendors/seats";

const FILL_CLASSES: Record<UtilizationTone, string> = {
  primary: "bg-primary",
  amber: "bg-amber",
};

// Replica .bar/.bar i/.bar i.low de docs/mockups.html: pista de 90px, teal
// normal, ámbar por debajo del 70% (ver utilizationTone).
export function UtilizationBar({
  pct,
  tone,
  className,
}: {
  pct: number;
  tone: UtilizationTone;
  className?: string;
}) {
  const width = Math.min(Math.max(pct, 0), 100);

  return (
    <span
      className={cn("inline-block h-1.5 w-[90px] overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        className={cn("block h-full rounded-full", FILL_CLASSES[tone])}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
