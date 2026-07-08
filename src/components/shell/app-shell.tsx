import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { CurrentUserProfile } from "@/features/auth/session";
import { BottomNav } from "./bottom-nav";
import { MobileHeader } from "./mobile-header";
import { Sidebar } from "./sidebar";

export async function AppShell({
  locale,
  profile,
  children,
}: {
  locale: string;
  profile: CurrentUserProfile;
  children: ReactNode;
}) {
  const t = await getTranslations("Auth.roles");
  const roleLabel = t(profile.role);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        locale={locale}
        role={profile.role}
        fullName={profile.fullName}
        roleLabel={roleLabel}
        orgName={profile.orgName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader
          locale={locale}
          fullName={profile.fullName}
          roleLabel={roleLabel}
          orgName={profile.orgName}
        />
        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-8 md:pb-8">{children}</main>
      </div>
      <BottomNav locale={locale} role={profile.role} />
    </div>
  );
}
