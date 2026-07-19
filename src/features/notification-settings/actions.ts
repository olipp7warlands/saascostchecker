"use server";

import type { ActionResult } from "@/lib/action-result";
import { getCurrentUserProfile } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  buildContractDeepLink,
  sendRenewalAlertEmail,
  sendRenewalAlertTeams,
  type RenewalAlertPayload,
} from "@/features/renewals/send-notifications";
import { upsertNotificationSettingsSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export type NotificationSettings = {
  emailAlertsEnabled: boolean;
  teamsAlertsEnabled: boolean;
  teamsWebhookUrl: string | null;
};

type GetOrgNotificationSettingsRow = {
  email_alerts_enabled: boolean;
  teams_alerts_enabled: boolean;
  teams_webhook_url: string | null;
};

export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_notification_settings").maybeSingle();

  if (error || !data) return null;
  const row = data as GetOrgNotificationSettingsRow;

  return {
    emailAlertsEnabled: row.email_alerts_enabled,
    teamsAlertsEnabled: row.teams_alerts_enabled,
    teamsWebhookUrl: row.teams_webhook_url,
  };
}

export async function saveNotificationSettings(input: unknown): Promise<ActionResult> {
  const parsed = upsertNotificationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_org_notification_settings", {
    p_email_alerts_enabled: parsed.data.emailAlertsEnabled,
    p_teams_alerts_enabled: parsed.data.teamsAlertsEnabled,
    p_teams_webhook_url: parsed.data.teamsWebhookUrl,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export type SendTestAlertResult = ActionResult & {
  emailSent?: boolean;
  teamsSent?: boolean;
  synthetic?: boolean;
};

// Prueba con los valores ACTUALES del formulario (aún sin guardar), no con
// la fila persistida — así el admin puede verificar el webhook antes de
// confirmar el guardado. Nunca escribe en `notifications`.
export async function sendTestAlert(input: unknown): Promise<SendTestAlertResult> {
  const parsed = upsertNotificationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const profile = await getCurrentUserProfile();
  if (!profile || profile.role !== "org_admin") {
    return { error: "insufficient_privileges" };
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("locale")
    .eq("id", profile.orgId)
    .single();
  const locale = (org?.locale ?? "es") as "es" | "en";

  const { data: nearestContract } = await supabase
    .from("contracts")
    .select("id, vendor_id, renewal_date")
    .eq("status", "active")
    .order("renewal_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const synthetic = !nearestContract;
  const deepLinkUrl = nearestContract
    ? buildContractDeepLink(locale, nearestContract.vendor_id, nearestContract.id)
    : `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://saascostchecker-production.up.railway.app"}/${locale}/vendors`;

  const payload: RenewalAlertPayload = nearestContract
    ? {
        vendor_name: locale === "es" ? "Ejemplo S.L." : "Example Inc.",
        contract_name: locale === "es" ? "Alerta de prueba" : "Test alert",
        renewal_date: nearestContract.renewal_date,
        days_until: 30,
      }
    : {
        vendor_name: locale === "es" ? "Ejemplo S.L. (sin contratos reales)" : "Example Inc. (no real contracts)",
        contract_name: locale === "es" ? "Alerta de prueba" : "Test alert",
        renewal_date: new Date().toISOString().slice(0, 10),
        days_until: 30,
      };

  let emailSent: boolean | undefined;
  let teamsSent: boolean | undefined;

  if (parsed.data.emailAlertsEnabled) {
    emailSent = await sendRenewalAlertEmail(profile.email, payload, locale, deepLinkUrl);
  }

  if (parsed.data.teamsAlertsEnabled && parsed.data.teamsWebhookUrl) {
    teamsSent = await sendRenewalAlertTeams(parsed.data.teamsWebhookUrl, payload, locale, deepLinkUrl);
  }

  if (emailSent === false || teamsSent === false) {
    return { error: "test_alert_failed", emailSent, teamsSent, synthetic };
  }

  return { success: true, emailSent, teamsSent, synthetic };
}
