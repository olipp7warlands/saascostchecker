import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  buildContractDeepLink,
  sendRenewalAlertEmail,
  sendRenewalAlertTeams,
  type RenewalAlertPayload,
} from "@/features/renewals/send-notifications";
import {
  buildPurchaseRequestResolvedTeamsCard,
  buildPurchaseRequestSubmittedTeamsCard,
  buildRequestDeepLink,
  sendPurchaseRequestResolvedEmail,
  sendPurchaseRequestSubmittedEmail,
  sendPurchaseRequestTeams,
  type PurchaseRequestResolvedPayload,
  type PurchaseRequestSubmittedPayload,
} from "@/features/requests/send-notifications";

// Disparada cada 15 min por trigger_send_pending_notifications() (pg_cron +
// pg_net, ver 0016_notification_channels.sql) — nunca por un cliente. El
// secreto compartido evita que cualquiera con la URL pueda forzar un envío.
function isAuthorized(request: NextRequest): boolean {
  const provided = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!provided || !expected) return false;

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // Guarda de longitud: timingSafeEqual lanza si los buffers no miden igual,
  // así que se compara primero fuera de la ruta de comparación de tiempo
  // constante — un 401 aquí no filtra nada sobre el valor del secreto real.
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}

type OneOrMany<T> = T | T[] | null;

function single<T>(relation: OneOrMany<T>): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

type NotificationType = "renewal_alert" | "purchase_request_submitted" | "purchase_request_resolved";

type PendingNotificationRow = {
  id: string;
  org_id: string;
  type: NotificationType;
  contract_id: string | null;
  request_id: string | null;
  threshold_days: number | null;
  payload: RenewalAlertPayload | PurchaseRequestSubmittedPayload | PurchaseRequestResolvedPayload;
  organizations: OneOrMany<{ locale: "es" | "en" }>;
  users: OneOrMany<{ email: string }>;
  contracts: OneOrMany<{ vendor_id: string }>;
};

// Intenta los canales aplicables y marca sent_at si al menos uno tuvo éxito
// (o si ninguno aplica). Compartido por los 3 tipos de notificación: el
// único branching por `type` vive en el bucle de POST(), al resolver
// emailFn/teamsFn — este helper no sabe nada del tipo concreto.
async function attemptAndMark(
  supabase: SupabaseClient,
  rowId: string,
  emailEnabled: boolean,
  teamsEnabled: boolean,
  emailFn: () => Promise<boolean>,
  teamsFn: (() => Promise<boolean>) | null,
): Promise<"processed" | "failed"> {
  const channels: string[] = [];
  let anyAttempted = false;
  let anySuccess = false;

  if (emailEnabled) {
    anyAttempted = true;
    if (await emailFn()) {
      channels.push("email");
      anySuccess = true;
    }
  }

  if (teamsEnabled && teamsFn) {
    anyAttempted = true;
    if (await teamsFn()) {
      channels.push("teams");
      anySuccess = true;
    }
  }

  // Fallo parcial: se marca sent_at en cuanto al menos un canal aplicable
  // tuvo éxito, o si ningún canal aplica (fila "no aplica", no se reintenta
  // indefinidamente). Si TODOS los canales aplicables fallan, sent_at queda
  // null y la siguiente pasada de 15 min reintenta — ver docs/DECISIONS.md
  // para la justificación (in-app es la garantía dura, email/Teams es una
  // capa de conveniencia sin retry por canal).
  const shouldMarkSent = !anyAttempted || anySuccess;

  if (shouldMarkSent) {
    await supabase
      .from("notifications")
      .update({ channels, sent_at: new Date().toISOString() })
      .eq("id", rowId);
    return "processed";
  }
  return "failed";
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: pending, error } = await supabase
    .from("notifications")
    .select(
      "id, org_id, type, contract_id, request_id, threshold_days, payload, organizations(locale), users(email), contracts(vendor_id)",
    )
    .is("sent_at", null)
    .in("type", ["renewal_alert", "purchase_request_submitted", "purchase_request_resolved"])
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { processed: 0, skipped: 0, failed: 0 };

  for (const row of (pending ?? []) as unknown as PendingNotificationRow[]) {
    try {
      const org = single(row.organizations);
      const user = single(row.users);
      const locale = org?.locale ?? "es";

      if (!user?.email) {
        results.skipped++;
        continue;
      }

      const { data: settings } = await supabase
        .from("org_notification_settings")
        .select("email_alerts_enabled, teams_alerts_enabled, teams_webhook_url")
        .eq("org_id", row.org_id)
        .maybeSingle();

      const emailEnabled = settings?.email_alerts_enabled ?? true;
      const teamsEnabled = settings?.teams_alerts_enabled ?? false;
      const teamsWebhookUrl = settings?.teams_webhook_url ?? null;

      let outcome: "processed" | "failed";

      if (row.type === "renewal_alert") {
        const contract = single(row.contracts);
        if (!contract?.vendor_id || !row.contract_id) {
          results.skipped++;
          continue;
        }
        const payload = row.payload as RenewalAlertPayload;
        const deepLinkUrl = buildContractDeepLink(locale, contract.vendor_id, row.contract_id);
        outcome = await attemptAndMark(
          supabase,
          row.id,
          emailEnabled,
          teamsEnabled,
          () => sendRenewalAlertEmail(user.email, payload, locale, deepLinkUrl),
          teamsWebhookUrl ? () => sendRenewalAlertTeams(teamsWebhookUrl, payload, locale, deepLinkUrl) : null,
        );
      } else if (row.type === "purchase_request_submitted") {
        if (!row.request_id) {
          results.skipped++;
          continue;
        }
        const payload = row.payload as PurchaseRequestSubmittedPayload;
        const deepLinkUrl = buildRequestDeepLink(locale, row.request_id);
        outcome = await attemptAndMark(
          supabase,
          row.id,
          emailEnabled,
          teamsEnabled,
          () => sendPurchaseRequestSubmittedEmail(user.email, payload, locale, deepLinkUrl),
          teamsWebhookUrl
            ? () =>
                sendPurchaseRequestTeams(
                  teamsWebhookUrl,
                  buildPurchaseRequestSubmittedTeamsCard(payload, locale, deepLinkUrl),
                )
            : null,
        );
      } else {
        if (!row.request_id) {
          results.skipped++;
          continue;
        }
        const payload = row.payload as PurchaseRequestResolvedPayload;
        const deepLinkUrl = buildRequestDeepLink(locale, row.request_id);
        outcome = await attemptAndMark(
          supabase,
          row.id,
          emailEnabled,
          teamsEnabled,
          () => sendPurchaseRequestResolvedEmail(user.email, payload, locale, deepLinkUrl),
          teamsWebhookUrl
            ? () =>
                sendPurchaseRequestTeams(
                  teamsWebhookUrl,
                  buildPurchaseRequestResolvedTeamsCard(payload, locale, deepLinkUrl),
                )
            : null,
        );
      }

      results[outcome]++;
    } catch (err) {
      console.error(`[send-notifications] notification ${row.id} failed`, err);
      results.failed++;
    }
  }

  return NextResponse.json(results);
}
