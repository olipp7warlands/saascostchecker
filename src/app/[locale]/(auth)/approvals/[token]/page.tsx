import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getApprovalRequestSummary, verifyApprovalToken } from "@/features/requests/approval-links";
import { routing } from "@/i18n/routing";
import { ApprovalDecisionForm } from "./approval-decision-form";

export default async function ApprovalLinkPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests.approvalLink");
  const tokenInfo = await verifyApprovalToken(token);
  const summary = tokenInfo ? await getApprovalRequestSummary(tokenInfo) : null;

  // Mismo mensaje genérico para CUALQUIER motivo de fallo (token no
  // encontrado/expirado/usado/revocado, o la solicitud ya no existe) — nunca
  // se distingue el motivo real.
  if (!summary) {
    return (
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-disp text-xl font-semibold text-ink">{t("invalidTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("invalidBody")}</p>
      </div>
    );
  }

  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: summary.currency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">{t("kicker")}</p>
        <h1 className="font-disp text-xl font-semibold text-ink">{summary.vendorName}</h1>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink">
        <p>{t("requestedBy", { name: summary.requesterName ?? t("unknownRequester") })}</p>
        <p className="num mt-1 text-lg font-semibold">{costFormatter.format(summary.estimatedAnnualCost)}</p>
        <p className="mt-2 whitespace-pre-wrap text-ink-soft">{summary.justification}</p>
      </div>

      <ApprovalDecisionForm token={token} />
    </div>
  );
}
