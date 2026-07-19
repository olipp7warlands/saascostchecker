import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  buildContractDeepLink,
  sendRenewalAlertEmail,
  sendRenewalAlertTeams,
  type RenewalAlertPayload,
} from "@/features/renewals/send-notifications";

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

type PendingNotificationRow = {
  id: string;
  org_id: string;
  contract_id: string | null;
  threshold_days: number | null;
  payload: RenewalAlertPayload;
  organizations: OneOrMany<{ locale: "es" | "en" }>;
  users: OneOrMany<{ email: string }>;
  contracts: OneOrMany<{ vendor_id: string }>;
};

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: pending, error } = await supabase
    .from("notifications")
    .select(
      "id, org_id, contract_id, threshold_days, payload, organizations(locale), users(email), contracts(vendor_id)",
    )
    .is("sent_at", null)
    .eq("type", "renewal_alert")
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { processed: 0, skipped: 0, failed: 0 };

  for (const row of (pending ?? []) as unknown as PendingNotificationRow[]) {
    try {
      const org = single(row.organizations);
      const user = single(row.users);
      const contract = single(row.contracts);
      const locale = org?.locale ?? "es";

      if (!user?.email || !contract?.vendor_id || !row.contract_id) {
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

      const deepLinkUrl = buildContractDeepLink(locale, contract.vendor_id, row.contract_id);

      const channels: string[] = [];
      let anyAttempted = false;
      let anySuccess = false;

      if (emailEnabled) {
        anyAttempted = true;
        const ok = await sendRenewalAlertEmail(user.email, row.payload, locale, deepLinkUrl);
        if (ok) {
          channels.push("email");
          anySuccess = true;
        }
      }

      if (teamsEnabled && teamsWebhookUrl) {
        anyAttempted = true;
        const ok = await sendRenewalAlertTeams(teamsWebhookUrl, row.payload, locale, deepLinkUrl);
        if (ok) {
          channels.push("teams");
          anySuccess = true;
        }
      }

      // Fallo parcial: se marca sent_at en cuanto al menos un canal aplicable
      // tuvo éxito, o si ningún canal aplica (fila "no aplica", no se
      // reintenta indefinidamente). Si TODOS los canales aplicables fallan,
      // sent_at queda null y la siguiente pasada de 15 min reintenta —
      // ver docs/DECISIONS.md para la justificación (in-app es la garantía
      // dura, email/Teams es una capa de conveniencia sin retry por canal).
      const shouldMarkSent = !anyAttempted || anySuccess;

      if (shouldMarkSent) {
        await supabase
          .from("notifications")
          .update({ channels, sent_at: new Date().toISOString() })
          .eq("id", row.id);
        results.processed++;
      } else {
        results.failed++;
      }
    } catch (err) {
      console.error(`[send-notifications] notification ${row.id} failed`, err);
      results.failed++;
    }
  }

  return NextResponse.json(results);
}
