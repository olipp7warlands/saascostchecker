import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { MemberRow } from "./member-row";

export default async function TeamMembersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Team.members");
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

  const [{ data: members }, { data: departments }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, role, department_id")
      .order("full_name", { ascending: true }),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <h1 className="font-disp text-xl font-semibold text-ink">{t("title")}</h1>

      <ul className="flex flex-col gap-2">
        {(members ?? []).map((member) => (
          <MemberRow key={member.id} member={member} departments={departments ?? []} />
        ))}
      </ul>
    </div>
  );
}
