import { getTranslations } from "next-intl/server";
import type { Role } from "@/features/auth/session";
import { isNavItemVisible, NAV_ITEMS, type NavItem } from "./nav-items";
import { NavLink } from "./nav-link";
import { MoreNavSheet, type SheetNavItem } from "./more-nav-sheet";

export async function BottomNav({ locale, role }: { locale: string; role: Role }) {
  const t = await getTranslations("Shell");
  const comingSoonLabel = t("nav.comingSoon");
  const items = NAV_ITEMS.filter((item) => item.bottomNav && isNavItemVisible(item, role));
  // Mismos items y mismo filtro de rol que usa el sidebar para sus grupos
  // "Datos"/"Ajustes" (sidebar.tsx) — el panel "Más" no duplica la lista,
  // solo muestra lo que no cabe como fijo en el bottom nav. Se resuelven a
  // props serializables (icon ya renderizado a ReactNode, label ya
  // traducido) antes de cruzar al Client Component: pasar el NavItem crudo
  // (con `icon: LucideIcon`, una referencia a componente) rompería el render
  // — mismo bug ya documentado en docs/DECISIONS.md (rediseño de tabs,
  // 2026-07-16) para nav-link.tsx.
  function toSheetItem(item: NavItem): SheetNavItem {
    return {
      key: item.key,
      href: item.href,
      icon: <item.icon className="size-4 shrink-0" aria-hidden="true" />,
      label: t(`nav.${item.key}`),
      comingSoonLabel,
    };
  }
  const dataItems = NAV_ITEMS.filter(
    (item) => item.section === "data" && isNavItemVisible(item, role),
  ).map(toSheetItem);
  const settingsItems = NAV_ITEMS.filter(
    (item) => item.section === "settings" && isNavItemVisible(item, role),
  ).map(toSheetItem);

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
      <MoreNavSheet
        locale={locale}
        moreLabel={t("nav.more")}
        moreTitle={t("nav.moreTitle")}
        moreCloseLabel={t("nav.moreClose")}
        dataSectionLabel={t("nav.dataSection")}
        settingsSectionLabel={t("nav.settingsSection")}
        dataItems={dataItems}
        settingsItems={settingsItems}
      />
    </nav>
  );
}
