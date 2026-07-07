import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { DepartmentForm } from "./department-form";
import { DepartmentRow } from "./department-row";

export default async function TeamDepartmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Team.departments");
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

  const [{ data: departments }, { data: members }] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name, manager_user_id")
      .order("name", { ascending: true }),
    supabase
      .from("users")
      .select("id, full_name, email")
      .order("full_name", { ascending: true }),
  ]);

  const orgMembers = members ?? [];

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <DepartmentForm members={orgMembers} />

      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("listTitle")}</h2>
        {!departments || departments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {departments.map((department) => (
              <DepartmentRow
                key={department.id}
                department={department}
                members={orgMembers}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
