import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-heading font-extrabold tracking-tight", className)}>
      stack<span className="text-lime">X</span>
    </span>
  );
}
