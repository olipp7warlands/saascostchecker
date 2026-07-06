import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getInvitationPreview } from "@/features/auth/actions";
import { AcceptInvitationForm } from "./accept-invitation-form";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Auth.invite");
  const tRoles = await getTranslations("Auth.roles");
  const preview = await getInvitationPreview(token);

  if (!preview) {
    return (
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-disp text-xl font-semibold text-ink">{t("invalidTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("invalidBody")}</p>
      </div>
    );
  }

  return (
    <AcceptInvitationForm
      locale={locale}
      token={token}
      orgName={preview.org_name}
      email={preview.email}
      roleLabel={tRoles(preview.role as "employee" | "manager" | "finance" | "it_admin" | "org_admin")}
    />
  );
}
