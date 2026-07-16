"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({ locale, dark = true }: { locale: string; dark?: boolean }) {
  const t = useTranslations("Shell.localeSwitcher");
  const pathname = usePathname();

  function pathForLocale(targetLocale: string) {
    const segments = pathname.split("/");
    segments[1] = targetLocale;
    return segments.join("/") || "/";
  }

  return (
    <div role="group" aria-label={t("label")} className="flex items-center gap-1">
      {routing.locales.map((loc) => {
        const active = loc === locale;
        return (
          <a
            key={loc}
            href={pathForLocale(loc)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide outline-none",
              "focus-visible:ring-2 focus-visible:ring-offset-1",
              dark
                ? cn(
                    "focus-visible:ring-white/50 focus-visible:ring-offset-ink",
                    active ? "bg-white/15 text-white" : "text-[#9AA7AE] hover:text-white",
                  )
                : cn(
                    "focus-visible:ring-ring/50 focus-visible:ring-offset-surface",
                    active
                      ? "bg-success-soft text-success"
                      : "text-ink-soft hover:text-ink",
                  ),
            )}
          >
            {loc.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
