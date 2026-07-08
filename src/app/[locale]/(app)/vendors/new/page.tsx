import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { NewVendorForm } from "./new-vendor-form";

const MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function NewVendorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Vendors");
  const profile = await getCurrentUserProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("users")
    .select("id, full_name, email")
    .order("full_name", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("new.title")}
      </h1>
      <div className="mt-6">
        <NewVendorForm locale={locale} members={members ?? []} />
      </div>
    </div>
  );
}
