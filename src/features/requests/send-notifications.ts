import { Resend } from "resend";
import { escapeHtml } from "@/features/renewals/send-notifications";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saascostchecker-production.up.railway.app";

// Mismo patrón que renewals/send-notifications.ts: cliente de Resend
// instanciado bajo demanda, nunca a nivel de módulo (evita arrastrar
// RESEND_API_KEY a un import desde un Client Component).
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

export type PurchaseRequestSubmittedPayload = {
  vendor_name: string;
  estimated_annual_cost: number;
  currency: string;
  requester_name: string | null;
};

export type PurchaseRequestResolvedPayload = {
  vendor_name: string;
  status: "approved" | "rejected";
  rejection_reason: string | null;
};

export function buildRequestDeepLink(locale: "es" | "en", requestId: string): string {
  return `${SITE_URL}/${locale}/requests/${requestId}`;
}

export function renderPurchaseRequestSubmittedEmail(
  payload: PurchaseRequestSubmittedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const requesterName = escapeHtml(payload.requester_name ?? "");
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });

  const subject =
    locale === "es"
      ? `Nueva solicitud de compra: ${payload.vendor_name}`
      : `New purchase request: ${payload.vendor_name}`;

  const bodyLine =
    locale === "es"
      ? `${requesterName} ha solicitado <strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/año). Pendiente de tu aprobación.`
      : `${requesterName} requested <strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/year). Awaiting your approval.`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">${bodyLine}</p>
      <a href="${deepLinkUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
    </div>
  `.trim();

  return { subject, html };
}

export function renderPurchaseRequestResolvedEmail(
  payload: PurchaseRequestResolvedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const ctaLabel = locale === "es" ? "Ver solicitud" : "View request";
  const approved = payload.status === "approved";

  const subject = approved
    ? locale === "es"
      ? `Solicitud aprobada: ${payload.vendor_name}`
      : `Request approved: ${payload.vendor_name}`
    : locale === "es"
      ? `Solicitud rechazada: ${payload.vendor_name}`
      : `Request rejected: ${payload.vendor_name}`;

  const reasonLine =
    !approved && payload.rejection_reason
      ? `<p style="font-size: 14px; line-height: 1.5; color: #6E7478; margin: 8px 0 24px;">${escapeHtml(payload.rejection_reason)}</p>`
      : "";

  const bodyLine = approved
    ? locale === "es"
      ? `Tu solicitud de <strong>${vendorName}</strong> ha sido aprobada.`
      : `Your request for <strong>${vendorName}</strong> has been approved.`
    : locale === "es"
      ? `Tu solicitud de <strong>${vendorName}</strong> ha sido rechazada.`
      : `Your request for <strong>${vendorName}</strong> has been rejected.`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0;">${bodyLine}</p>
      ${reasonLine || '<div style="margin-bottom: 24px;"></div>'}
      <a href="${deepLinkUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
    </div>
  `.trim();

  return { subject, html };
}

export function buildPurchaseRequestSubmittedTeamsCard(
  payload: PurchaseRequestSubmittedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): object {
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const title = locale === "es" ? "Nueva solicitud de compra" : "New purchase request";
  const text =
    locale === "es"
      ? `${payload.requester_name ?? ""} ha solicitado "${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/año).`
      : `${payload.requester_name ?? ""} requested "${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/year).`;

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

export function buildPurchaseRequestResolvedTeamsCard(
  payload: PurchaseRequestResolvedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): object {
  const ctaLabel = locale === "es" ? "Ver solicitud" : "View request";
  const approved = payload.status === "approved";
  const title = approved
    ? locale === "es"
      ? "Solicitud aprobada"
      : "Request approved"
    : locale === "es"
      ? "Solicitud rechazada"
      : "Request rejected";
  const text = approved
    ? locale === "es"
      ? `Tu solicitud de "${payload.vendor_name}" ha sido aprobada.`
      : `Your request for "${payload.vendor_name}" has been approved.`
    : locale === "es"
      ? `Tu solicitud de "${payload.vendor_name}" ha sido rechazada.${payload.rejection_reason ? ` Motivo: ${payload.rejection_reason}` : ""}`
      : `Your request for "${payload.vendor_name}" has been rejected.${payload.rejection_reason ? ` Reason: ${payload.rejection_reason}` : ""}`;

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

export async function sendPurchaseRequestSubmittedEmail(
  to: string,
  payload: PurchaseRequestSubmittedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): Promise<boolean> {
  const { subject, html } = renderPurchaseRequestSubmittedEmail(payload, locale, deepLinkUrl);
  return sendEmail(to, subject, html, "purchase-request-submitted-email");
}

export async function sendPurchaseRequestResolvedEmail(
  to: string,
  payload: PurchaseRequestResolvedPayload,
  locale: "es" | "en",
  deepLinkUrl: string,
): Promise<boolean> {
  const { subject, html } = renderPurchaseRequestResolvedEmail(payload, locale, deepLinkUrl);
  return sendEmail(to, subject, html, "purchase-request-resolved-email");
}

async function sendEmail(to: string, subject: string, html: string, logTag: string): Promise<boolean> {
  const resend = getResendClient();

  if (!resend) {
    console.info(`[${logTag}] ${to}: ${subject}`);
    return true;
  }

  try {
    const { error } = await resend.emails.send({ from: "StackX <onboarding@resend.dev>", to, subject, html });
    return !error;
  } catch (err) {
    console.error(`[${logTag}] failed to send to ${to}`, err);
    return false;
  }
}

export async function sendPurchaseRequestTeams(webhookUrl: string, card: object): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    return response.ok;
  } catch (err) {
    console.error(`[purchase-request-teams] failed to post to webhook`, err);
    return false;
  }
}
