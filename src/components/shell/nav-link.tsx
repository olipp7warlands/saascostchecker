import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

export function NavLink({
  item,
  locale,
  label,
  comingSoonLabel,
  variant,
}: {
  item: NavItem;
  locale: string;
  label: string;
  comingSoonLabel: string;
  variant: "sidebar" | "bottom";
}) {
  const Icon = item.icon;
  const disabled = !item.href;
  const href = item.href ? `/${locale}${item.href}` : undefined;

  const className = cn(
    variant === "sidebar"
      ? "flex items-center gap-2.5 border-l-[3px] border-transparent px-5 py-[9px] text-sm font-medium outline-none"
      : "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-center text-[10.5px] font-semibold whitespace-nowrap outline-none",
    disabled
      ? "cursor-not-allowed text-[#5B6874]"
      : cn(
          "text-[#9AA7AE] hover:text-white",
          variant === "sidebar"
            ? "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50"
            : "focus-visible:ring-2 focus-visible:ring-white/50",
        ),
  );

  const content = (
    <>
      <Icon className={variant === "sidebar" ? "size-4 shrink-0" : "size-[17px]"} aria-hidden="true" />
      <span className={variant === "sidebar" ? "flex-1 truncate" : undefined}>{label}</span>
      {disabled && variant === "sidebar" && (
        <span className="shrink-0 rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap text-[#5B6874]">
          {comingSoonLabel}
        </span>
      )}
      {disabled && variant === "bottom" && <span className="sr-only"> ({comingSoonLabel})</span>}
    </>
  );

  if (disabled) {
    return (
      <span aria-disabled="true" tabIndex={-1} className={className}>
        {content}
      </span>
    );
  }

  return (
    <a href={href} className={className}>
      {content}
    </a>
  );
}
