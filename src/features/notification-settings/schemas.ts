import { z } from "zod";

// Mismo patrón anti-SSRF que valida upsert_org_notification_settings() en
// 0016_notification_channels.sql (la autoridad real, security definer, no
// confía en esta capa) — https obligatorio, host anclado a *.webhook.office.com
// o *.logic.azure.com, para que un truco tipo "https://evil.com/webhook.office.com"
// no cuele.
const TEAMS_WEBHOOK_HOST_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*(webhook\.office\.com|logic\.azure\.com)(\/.*)?$/i;

export function isValidTeamsWebhookUrl(value: string): boolean {
  return TEAMS_WEBHOOK_HOST_PATTERN.test(value);
}

const teamsWebhookUrlSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().trim().nullable(),
);

export const upsertNotificationSettingsSchema = z
  .object({
    emailAlertsEnabled: z.boolean(),
    teamsAlertsEnabled: z.boolean(),
    teamsWebhookUrl: teamsWebhookUrlSchema,
  })
  .refine((data) => !data.teamsAlertsEnabled || !!data.teamsWebhookUrl, {
    message: "teams_webhook_url_required",
    path: ["teamsWebhookUrl"],
  })
  .refine((data) => !data.teamsWebhookUrl || isValidTeamsWebhookUrl(data.teamsWebhookUrl), {
    // Código estable, no un mensaje en un idioma fijo — el form lo traduce
    // vía Settings.notifications.teamsWebhookInvalidDomain (es/en).
    message: "teams_webhook_invalid_domain",
    path: ["teamsWebhookUrl"],
  });

export type UpsertNotificationSettingsInput = z.infer<typeof upsertNotificationSettingsSchema>;
