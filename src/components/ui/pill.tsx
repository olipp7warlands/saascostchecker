import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  green: "bg-primary-soft text-primary",
  amber: "bg-amber-soft text-[#B27A1E]",
  red: "bg-red-soft text-destructive",
  neutral: "bg-muted text-ink-soft",
} as const;

export type PillTone = keyof typeof TONE_CLASSES;

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
