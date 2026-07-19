import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getNotificationSettings } from "@/features/notification-settings/actions";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Settings.notifications");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("auth_id", user.id)
    .single();

  if (!profile || profile.role !== "org_admin") {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const settings = await getNotificationSettings();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <NotificationSettingsForm initialSettings={settings} />
    </div>
  );
}
