import { colorForName } from "@/features/catalog/color";
import { cn } from "@/lib/utils";

// Iniciales: hasta las primeras 2 palabras del nombre. Sin nombre -> "?"
// (no debe romper el render si el dato todavía no llegó).
function initialsForName(name: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: colorForName(name ?? "?"),
        fontSize: Math.round(size * 0.46),
      }}
    >
      {initialsForName(name)}
    </span>
  );
}
