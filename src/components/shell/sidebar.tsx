import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand/wordmark";
import type { Role } from "@/features/auth/session";
import { LocaleSwitcher } from "./locale-switcher";
import { isNavItemVisible, NAV_ITEMS } from "./nav-items";
import { NavLink } from "./nav-link";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

export async function Sidebar({
  locale,
  role,
  fullName,
  roleLabel,
  orgName,
}: {
  locale: string;
  role: Role;
  fullName: string | null;
  roleLabel: string;
  orgName: string;
}) {
  const t = await getTranslations("Shell");
  const comingSoonLabel = t("nav.comingSoon");

  const primary = NAV_ITEMS.filter((item) => !item.section && isNavItemVisible(item, role));
  const dataItems = NAV_ITEMS.filter(
    (item) => item.section === "data" && isNavItemVisible(item, role),
  );
  const settingsItems = NAV_ITEMS.filter(
    (item) => item.section === "settings" && isNavItemVisible(item, role),
  );

  return (
    <aside className="hidden w-[216px] shrink-0 flex-col border-r border-line bg-surface py-5 text-ink md:flex">
      <div className="flex items-center justify-between px-5 pb-[22px]">
        <Wordmark className="text-[19px] text-ink" />
        <NotificationBell dark={false} />
      </div>

      <nav aria-label={t("mainNavLabel")} className="flex flex-1 flex-col overflow-y-auto">
        {primary.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            locale={locale}
            icon={<item.icon className="size-4 shrink-0" aria-hidden="true" />}
            label={t(`nav.${item.key}`)}
            comingSoonLabel={comingSoonLabel}
            variant="sidebar"
          />
        ))}

        {dataItems.length > 0 && (
          <>
            <p className="px-5 pt-[18px] pb-1.5 text-[10.5px] font-semibold tracking-[.1em] text-ink-soft uppercase">
              {t("nav.dataSection")}
            </p>
            {dataItems.map((item) => (
              <NavLink
                key={item.key}
                href={item.href}
                locale={locale}
                icon={<item.icon className="size-4 shrink-0" aria-hidden="true" />}
                label={t(`nav.${item.key}`)}
                comingSoonLabel={comingSoonLabel}
                variant="sidebar"
              />
            ))}
          </>
        )}

        {settingsItems.length > 0 && (
          <>
            <p className="px-5 pt-[18px] pb-1.5 text-[10.5px] font-semibold tracking-[.1em] text-ink-soft uppercase">
              {t("nav.settingsSection")}
            </p>
            {settingsItems.map((item) => (
              <NavLink
                key={item.key}
                href={item.href}
                locale={locale}
                icon={<item.icon className="size-4 shrink-0" aria-hidden="true" />}
                label={t(`nav.${item.key}`)}
                comingSoonLabel={comingSoonLabel}
                variant="sidebar"
              />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto border-t border-line px-3 pt-4">
        <UserMenu
          locale={locale}
          fullName={fullName}
          roleLabel={roleLabel}
          orgName={orgName}
          dark={false}
        />
        <div className="mt-3 px-1.5">
          <LocaleSwitcher locale={locale} dark={false} />
        </div>
      </div>
    </aside>
  );
}
