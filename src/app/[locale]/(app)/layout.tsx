import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const profile = await getCurrentUserProfile();
  if (!profile) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell locale={locale} profile={profile}>
      {children}
    </AppShell>
  );
}
