import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saascostchecker-production.up.railway.app";

export type RenewalAlertPayload = {
  vendor_name: string;
  contract_name: string;
  renewal_date: string;
  days_until?: number;
  notice_days?: number;
  notice_expired?: boolean;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildContractDeepLink(locale: "es" | "en", vendorId: string, contractId: string): string {
  return `${SITE_URL}/${locale}/vendors/${vendorId}#contract-${contractId}`;
}

export function renderRenewalAlertEmail(
  payload: RenewalAlertPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const contractName = escapeHtml(payload.contract_name);
  const ctaLabel = locale === "es" ? "Ver contrato" : "View contract";

  let subject: string;
  let bodyLine: string;

  if (payload.notice_expired) {
    subject =
      locale === "es"
        ? `Preaviso de cancelación vencido: ${payload.contract_name}`
        : `Cancellation notice deadline passed: ${payload.contract_name}`;
    bodyLine =
      locale === "es"
        ? `El plazo de preaviso de cancelación (${payload.notice_days} días) de <strong>${contractName}</strong> (${vendorName}) ha vencido. La renovación es el ${payload.renewal_date}.`
        : `The cancellation notice deadline (${payload.notice_days} days) for <strong>${contractName}</strong> (${vendorName}) has passed. Renewal date is ${payload.renewal_date}.`;
  } else {
    subject =
      locale === "es"
        ? `${payload.contract_name} se renueva en ${payload.days_until} días`
        : `${payload.contract_name} renews in ${payload.days_until} days`;
    bodyLine =
      locale === "es"
        ? `<strong>${contractName}</strong> (${vendorName}) se renueva el ${payload.renewal_date} — dentro de ${payload.days_until} días.`
        : `<strong>${contractName}</strong> (${vendorName}) renews on ${payload.renewal_date} — in ${payload.days_until} days.`;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">${bodyLine}</p>
      <a href="${deepLinkUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
    </div>
  `.trim();

  return { subject, html };
}

export function buildTeamsAdaptiveCard(
  payload: RenewalAlertPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): object {
  const ctaLabel = locale === "es" ? "Ver contrato" : "View contract";

  const title = payload.notice_expired
    ? locale === "es"
      ? "Preaviso de cancelación vencido"
      : "Cancellation notice deadline passed"
    : locale === "es"
      ? "Renovación próxima"
      : "Upcoming renewal";

  const text = payload.notice_expired
    ? locale === "es"
      ? `El plazo de preaviso (${payload.notice_days} días) de "${payload.contract_name}" (${payload.vendor_name}) ha vencido. Renovación: ${payload.renewal_date}.`
      : `The notice deadline (${payload.notice_days} days) for "${payload.contract_name}" (${payload.vendor_name}) has passed. Renewal: ${payload.renewal_date}.`
    : locale === "es"
      ? `"${payload.contract_name}" (${payload.vendor_name}) se renueva el ${payload.renewal_date} — dentro de ${payload.days_until} días.`
      : `"${payload.contract_name}" (${payload.vendor_name}) renews on ${payload.renewal_date} — in ${payload.days_until} days.`;

  // Formato Adaptive Card v1.4 envuelto en "attachments" (patrón de los
  // workflows de Teams sobre logic.azure.com); los Incoming Webhooks clásicos
  // sobre webhook.office.com también lo aceptan en despliegues recientes de
  // Teams. Si un webhook concreto no lo renderiza, es el único caso no
  // cubierto por este bloque — ver docs/DECISIONS.md.
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: [
            { type: "TextBlock", text: title, weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text, wrap: true },
          ],
          actions: [{ type: "Action.OpenUrl", title: ctaLabel, url: deepLinkUrl }],
        },
      },
    ],
  };
}

export async function sendRenewalAlertEmail(
  to: string,
  payload: RenewalAlertPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): Promise<boolean> {
  const { subject, html } = renderRenewalAlertEmail(payload, locale, deepLinkUrl);

  if (!resend) {
    console.info(`[renewal-alert-email] ${to}: ${subject}`);
    return true;
  }

  try {
    const { error } = await resend.emails.send({
      from: "StackX <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
    return !error;
  } catch (err) {
    console.error(`[renewal-alert-email] failed to send to ${to}`, err);
    return false;
  }
}

export async function sendRenewalAlertTeams(
  webhookUrl: string,
  payload: RenewalAlertPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): Promise<boolean> {
  const card = buildTeamsAdaptiveCard(payload, locale, deepLinkUrl);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    return response.ok;
  } catch (err) {
    console.error(`[renewal-alert-teams] failed to post to webhook`, err);
    return false;
  }
}
