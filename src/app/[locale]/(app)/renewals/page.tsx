import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { getCurrentUserProfile } from "@/features/auth/session";
import { fetchDashboardContracts } from "@/features/dashboard/fetch-contracts";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { RenewalsCalendar } from "./renewals-calendar";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function RenewalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Renewals");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const [{ contracts }, { data: departmentRows }, { data: companyRows }] = await Promise.all([
    fetchDashboardContracts(supabase),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("companies").select("id, name").order("name", { ascending: true }),
  ]);

  return (
    <div>
      <Breadcrumbs items={[{ label: t("crumb") }]} />
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("title")}
      </h1>

      <div className="mt-6">
        <RenewalsCalendar
          contracts={contracts}
          companies={companyRows ?? []}
          departments={departmentRows ?? []}
          locale={locale}
        />
      </div>
    </div>
  );
}
