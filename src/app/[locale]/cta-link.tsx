import { cn } from "@/lib/utils";

export function CtaLink({
  href,
  variant = "primary",
  size = "default",
  className,
  children,
}: {
  href: string;
  variant?: "primary" | "ghost";
  size?: "default" | "big";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        "inline-block rounded-btn font-semibold whitespace-nowrap transition-colors",
        size === "big" ? "px-6.5 py-3.5 text-base" : "px-5 py-2.5 text-[15px]",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-[#2A2E30]"
          : "border border-line bg-transparent text-ink hover:bg-muted",
        className,
      )}
    >
      {children}
    </a>
  );
}
