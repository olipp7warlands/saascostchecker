import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { CompanyForm } from "./company-form";
import { CompanyRow } from "./company-row";

export default async function TeamCompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Team.companies");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, org_id")
    .eq("auth_id", user.id)
    .single();

  if (!profile || profile.role !== "org_admin") {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, tax_id, is_default")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <CompanyForm />

      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("listTitle")}</h2>
        {!companies || companies.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {companies.map((company) => (
              <CompanyRow key={company.id} company={company} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
