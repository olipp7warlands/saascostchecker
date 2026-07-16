import { cn } from "@/lib/utils";

export function FichaField({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium tracking-[.04em] text-ink-soft uppercase">
        {label}
      </span>
      <span className={cn("text-[15px] font-medium text-ink", mono && "num")}>{value}</span>
    </div>
  );
}
