import { describe, expect, it } from "vitest";
import { isValidTeamsWebhookUrl, upsertNotificationSettingsSchema } from "./schemas";

describe("isValidTeamsWebhookUrl", () => {
  it("acepta https sobre webhook.office.com y logic.azure.com", () => {
    expect(isValidTeamsWebhookUrl("https://foo.webhook.office.com/webhookb2/abc")).toBe(true);
    expect(isValidTeamsWebhookUrl("https://bar.logic.azure.com/workflows/xyz")).toBe(true);
  });

  it("rechaza http (no https)", () => {
    expect(isValidTeamsWebhookUrl("http://foo.webhook.office.com/webhookb2/abc")).toBe(false);
  });

  it("rechaza un dominio arbitrario", () => {
    expect(isValidTeamsWebhookUrl("https://example.com/webhook")).toBe(false);
  });

  it("rechaza el truco de dominio en el path (SSRF): host real distinto al permitido", () => {
    expect(isValidTeamsWebhookUrl("https://evil.com/webhook.office.com")).toBe(false);
    expect(isValidTeamsWebhookUrl("https://webhook.office.com.evil.com/x")).toBe(false);
  });
});

describe("upsertNotificationSettingsSchema", () => {
  it("exige teamsWebhookUrl cuando teamsAlertsEnabled es true", () => {
    const result = upsertNotificationSettingsSchema.safeParse({
      emailAlertsEnabled: true,
      teamsAlertsEnabled: true,
      teamsWebhookUrl: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("teams_webhook_url_required");
    }
  });

  it("rechaza un dominio no permitido con el código teams_webhook_invalid_domain", () => {
    const result = upsertNotificationSettingsSchema.safeParse({
      emailAlertsEnabled: true,
      teamsAlertsEnabled: true,
      teamsWebhookUrl: "https://example.com/webhook",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("teams_webhook_invalid_domain");
    }
  });

  it("acepta teamsAlertsEnabled=false sin webhook", () => {
    const result = upsertNotificationSettingsSchema.safeParse({
      emailAlertsEnabled: true,
      teamsAlertsEnabled: false,
      teamsWebhookUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("acepta una URL válida con teamsAlertsEnabled=true", () => {
    const result = upsertNotificationSettingsSchema.safeParse({
      emailAlertsEnabled: false,
      teamsAlertsEnabled: true,
      teamsWebhookUrl: "https://foo.webhook.office.com/webhookb2/abc",
    });
    expect(result.success).toBe(true);
  });
});
