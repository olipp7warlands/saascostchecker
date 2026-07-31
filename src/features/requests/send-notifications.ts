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

export type PurchaseRequestStepPendingPayload = {
  vendor_name: string;
  estimated_annual_cost: number;
  currency: string;
  requester_name: string | null;
  approval_token: string;
  known_overlap: boolean;
};

export type PurchaseRequestReminderPayload = {
  vendor_name: string;
  estimated_annual_cost: number;
  currency: string;
  approval_token: string;
  known_overlap: boolean;
};

export type PurchaseRequestEscalatedPayload = {
  vendor_name: string;
  estimated_annual_cost: number;
  currency: string;
  approval_token: string;
  known_overlap: boolean;
};

export type PurchaseRequestResolvedPayload = {
  vendor_name: string;
  status: "approved" | "rejected";
  rejection_reason: string | null;
};

export function buildRequestDeepLink(locale: "es" | "en", requestId: string): string {
  return `${SITE_URL}/${locale}/requests/${requestId}`;
}

// El link de aprobación (aprobar/rechazar SIN login) es el CTA principal de
// step_pending/reminder/escalated — no el deep link normal, que exige
// sesión. Formato del token: ver approval-links.ts.
export function buildApprovalActionLink(locale: "es" | "en", approvalToken: string): string {
  return `${SITE_URL}/${locale}/approvals/${approvalToken}`;
}

export function renderPurchaseRequestStepPendingEmail(
  payload: PurchaseRequestStepPendingPayload,
  locale: "es" | "en",
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const requesterName = escapeHtml(payload.requester_name ?? "");
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const actionUrl = buildApprovalActionLink(locale, payload.approval_token);

  const subject =
    locale === "es"
      ? `Solicitud pendiente de tu aprobación: ${payload.vendor_name}`
      : `Purchase request awaiting your approval: ${payload.vendor_name}`;

  const bodyLine =
    locale === "es"
      ? `${requesterName} ha solicitado <strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/año). Pendiente de tu aprobación.`
      : `${requesterName} requested <strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/year). Awaiting your approval.`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 8px;">${bodyLine}</p>
      ${knownOverlapLine(payload.known_overlap, locale)}
      <div style="margin-bottom: 16px;"></div>
      <a href="${actionUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
    </div>
  `.trim();

  return { subject, html };
}

// Bloque 3.4 — aviso corto compartido por los 3 emails de aprobación
// pendiente (step_pending/reminder/escalated) cuando la solicitud fue creada
// a pesar de un solapamiento conocido con el stack existente.
function knownOverlapLine(knownOverlap: boolean, locale: "es" | "en"): string {
  if (!knownOverlap) return "";
  const text =
    locale === "es"
      ? "⚠ Ya existe una herramienta similar contratada en tu organización."
      : "⚠ A similar tool is already in place in your organization.";
  return `<p style="font-size: 13px; color: #B45309; margin: 0;">${text}</p>`;
}

export function renderPurchaseRequestReminderEmail(
  payload: PurchaseRequestReminderPayload,
  locale: "es" | "en",
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const actionUrl = buildApprovalActionLink(locale, payload.approval_token);

  const subject =
    locale === "es"
      ? `Recordatorio: solicitud pendiente de tu aprobación`
      : `Reminder: purchase request awaiting your approval`;

  const bodyLine =
    locale === "es"
      ? `<strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/año) sigue pendiente de tu aprobación desde hace 3 días.`
      : `<strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/year) has been awaiting your approval for 3 days.`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 8px;">${bodyLine}</p>
      ${knownOverlapLine(payload.known_overlap, locale)}
      <div style="margin-bottom: 16px;"></div>
      <a href="${actionUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
    </div>
  `.trim();

  return { subject, html };
}

export function renderPurchaseRequestEscalatedEmail(
  payload: PurchaseRequestEscalatedPayload,
  locale: "es" | "en",
): { subject: string; html: string } {
  const vendorName = escapeHtml(payload.vendor_name);
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const actionUrl = buildApprovalActionLink(locale, payload.approval_token);

  const subject =
    locale === "es" ? `Solicitud escalada a administración` : `Request escalated to admin`;

  const bodyLine =
    locale === "es"
      ? `<strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/año) llevaba 7 días sin aprobador y se ha escalado a administración.`
      : `<strong>${vendorName}</strong> (${costFormatter.format(payload.estimated_annual_cost)}/year) had no approver response after 7 days and was escalated to admin.`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #15181A; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6E7478; margin: 0 0 16px;">StackX</p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 8px;">${bodyLine}</p>
      ${knownOverlapLine(payload.known_overlap, locale)}
      <div style="margin-bottom: 16px;"></div>
      <a href="${actionUrl}" style="display: inline-block; background: #15181A; color: #C6FF3E; text-decoration: none; padding: 10px 20px; border-radius: 16px; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
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

export function buildPurchaseRequestStepPendingTeamsCard(
  payload: PurchaseRequestStepPendingPayload,
  locale: "es" | "en",
): object {
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const title = locale === "es" ? "Solicitud pendiente de tu aprobación" : "Purchase request awaiting your approval";
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
            ...knownOverlapTeamsBlock(payload.known_overlap, locale),
          ],
          actions: [
            { type: "Action.OpenUrl", title: ctaLabel, url: buildApprovalActionLink(locale, payload.approval_token) },
          ],
        },
      },
    ],
  };
}

// Bloque 3.4 — mismo aviso que knownOverlapLine() (email), en forma de
// bloque de tarjeta Adaptive Card; array vacío si no aplica (spread directo
// en el `body` de cada tarjeta, sin condicional aparte por tarjeta).
function knownOverlapTeamsBlock(knownOverlap: boolean, locale: "es" | "en"): object[] {
  if (!knownOverlap) return [];
  const text =
    locale === "es"
      ? "⚠ Ya existe una herramienta similar contratada en tu organización."
      : "⚠ A similar tool is already in place in your organization.";
  return [{ type: "TextBlock", text, wrap: true, color: "Warning", size: "Small" }];
}

export function buildPurchaseRequestReminderTeamsCard(
  payload: PurchaseRequestReminderPayload,
  locale: "es" | "en",
): object {
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const title = locale === "es" ? "Recordatorio: solicitud pendiente" : "Reminder: pending purchase request";
  const text =
    locale === "es"
      ? `"${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/año) sigue pendiente de tu aprobación.`
      : `"${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/year) is still awaiting your approval.`;

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
            ...knownOverlapTeamsBlock(payload.known_overlap, locale),
          ],
          actions: [
            { type: "Action.OpenUrl", title: ctaLabel, url: buildApprovalActionLink(locale, payload.approval_token) },
          ],
        },
      },
    ],
  };
}

export function buildPurchaseRequestEscalatedTeamsCard(
  payload: PurchaseRequestEscalatedPayload,
  locale: "es" | "en",
): object {
  const ctaLabel = locale === "es" ? "Revisar solicitud" : "Review request";
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0,
  });
  const title = locale === "es" ? "Solicitud escalada a administración" : "Request escalated to admin";
  const text =
    locale === "es"
      ? `"${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/año) llevaba 7 días sin respuesta y se ha escalado.`
      : `"${payload.vendor_name}" (${costFormatter.format(payload.estimated_annual_cost)}/year) had no response after 7 days and was escalated.`;

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
            ...knownOverlapTeamsBlock(payload.known_overlap, locale),
          ],
          actions: [
            { type: "Action.OpenUrl", title: ctaLabel, url: buildApprovalActionLink(locale, payload.approval_token) },
          ],
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

export async function sendPurchaseRequestStepPendingEmail(
  to: string,
  payload: PurchaseRequestStepPendingPayload,
  locale: "es" | "en",
): Promise<boolean> {
  const { subject, html } = renderPurchaseRequestStepPendingEmail(payload, locale);
  return sendEmail(to, subject, html, "purchase-request-step-pending-email");
}

export async function sendPurchaseRequestReminderEmail(
  to: string,
  payload: PurchaseRequestReminderPayload,
  locale: "es" | "en",
): Promise<boolean> {
  const { subject, html } = renderPurchaseRequestReminderEmail(payload, locale);
  return sendEmail(to, subject, html, "purchase-request-reminder-email");
}

export async function sendPurchaseRequestEscalatedEmail(
  to: string,
  payload: PurchaseRequestEscalatedPayload,
  locale: "es" | "en",
): Promise<boolean> {
  const { subject, html } = renderPurchaseRequestEscalatedEmail(payload, locale);
  return sendEmail(to, subject, html, "purchase-request-escalated-email");
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
