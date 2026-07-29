import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { NewRequestForm } from "./new-request-form";

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests");
  const profile = await getCurrentUserProfile();
  if (!profile) {
    notFound();
  }

  const supabase = await createClient();
  const [{ data: departments }, { data: callerRow }, { data: org }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("users").select("department_id").eq("auth_id", profile.authId).single(),
    supabase.from("organizations").select("default_currency").eq("id", profile.orgId).single(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs tracking-[.08em] text-ink-soft uppercase">{t("crumb")}</p>
      <h1 className="mt-1.5 font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
        {t("new.title")}
      </h1>
      <div className="mt-6">
        <NewRequestForm
          locale={locale}
          departments={departments ?? []}
          callerDepartmentId={callerRow?.department_id ?? null}
          defaultCurrency={org?.default_currency ?? "EUR"}
        />
      </div>
    </div>
  );
}
