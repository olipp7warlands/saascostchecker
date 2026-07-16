import { getTranslations } from "next-intl/server";
import type { Role } from "@/features/auth/session";
import { isNavItemVisible, NAV_ITEMS } from "./nav-items";
import { NavLink } from "./nav-link";

export async function BottomNav({ locale, role }: { locale: string; role: Role }) {
  const t = await getTranslations("Shell");
  const comingSoonLabel = t("nav.comingSoon");
  const items = NAV_ITEMS.filter((item) => item.bottomNav && isNavItemVisible(item, role));

  return (
    <nav
      aria-label={t("mobileNavLabel")}
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden"
    >
      {items.map((item) => (
        <NavLink
          key={item.key}
          href={item.href}
          locale={locale}
          icon={<item.icon className="size-[17px]" aria-hidden="true" />}
          label={t(`nav.${item.key}`)}
          comingSoonLabel={comingSoonLabel}
          variant="bottom"
        />
      ))}
    </nav>
  );
}
