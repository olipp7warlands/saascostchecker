import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { InviteForm } from "./invite-form";
import { RevokeButton } from "./revoke-button";

export default async function TeamInvitePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Team.invite");
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

  if (!profile || !["org_admin", "it_admin"].includes(profile.role)) {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.org_id)
    .single();

  const { data: pendingInvitations } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at")
    .is("used_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <InviteForm locale={locale} orgName={organization?.name ?? ""} />

      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("pendingTitle")}</h2>
        {!pendingInvitations || pendingInvitations.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pendingInvitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{invitation.email}</p>
                  <p className="text-xs text-ink-soft">
                    {invitation.role} ·{" "}
                    {t("expiresLabel", {
                      date: new Date(invitation.expires_at).toLocaleDateString(locale),
                    })}
                  </p>
                </div>
                <RevokeButton invitationId={invitation.id} label={t("revoke")} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
