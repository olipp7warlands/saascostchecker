"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function NavLink({
  href: rawHref,
  locale,
  icon,
  label,
  comingSoonLabel,
  variant,
}: {
  href: string | null;
  locale: string;
  icon: ReactNode;
  label: string;
  comingSoonLabel: string;
  variant: "sidebar" | "bottom";
}) {
  const disabled = !rawHref;
  const href = rawHref ? `/${locale}${rawHref}` : undefined;
  const pathname = usePathname();
  const active = !disabled && href != null && (pathname === href || pathname.startsWith(`${href}/`));

  const className = cn(
    variant === "sidebar"
      ? cn(
          "flex items-center gap-2.5 border-l-[3px] px-5 py-[9px] text-sm font-medium outline-none",
          active ? "border-l-lime" : "border-l-transparent",
        )
      : "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-center text-[10.5px] font-semibold whitespace-nowrap outline-none",
    disabled
      ? "cursor-not-allowed text-ink-soft/60"
      : cn(
          active ? "bg-lime-soft text-lime-ink" : "text-ink-soft hover:text-ink",
          variant === "sidebar"
            ? "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            : "focus-visible:ring-2 focus-visible:ring-ring/50",
        ),
  );

  const content = (
    <>
      {icon}
      <span className={variant === "sidebar" ? "flex-1 truncate" : undefined}>{label}</span>
      {disabled && variant === "sidebar" && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap text-ink-soft/60">
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
    <a href={href} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </a>
  );
}
