"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  saveNotificationSettings,
  sendTestAlert,
  type NotificationSettings,
} from "@/features/notification-settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERROR_MESSAGE_KEYS: Record<string, string> = {
  teams_webhook_url_required: "teamsWebhookRequired",
  teams_webhook_invalid_domain: "teamsWebhookInvalidDomain",
};

export function NotificationSettingsForm({
  initialSettings,
}: {
  initialSettings: NotificationSettings | null;
}) {
  const t = useTranslations("Settings.notifications");
  const tGeneric = useTranslations("Auth");
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(initialSettings?.emailAlertsEnabled ?? true);
  const [teamsAlertsEnabled, setTeamsAlertsEnabled] = useState(initialSettings?.teamsAlertsEnabled ?? false);
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(initialSettings?.teamsWebhookUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();

  function currentInput() {
    return {
      emailAlertsEnabled,
      teamsAlertsEnabled,
      teamsWebhookUrl: teamsWebhookUrl.trim() === "" ? null : teamsWebhookUrl.trim(),
    };
  }

  function resolveErrorMessage(code: string) {
    const key = ERROR_MESSAGE_KEYS[code];
    return key ? t(key) : code || tGeneric("errorGeneric");
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    setTestResult(null);
    startSaveTransition(async () => {
      const result = await saveNotificationSettings(currentInput());
      if ("error" in result) {
        setError(resolveErrorMessage(result.error));
      } else {
        setSaved(true);
      }
    });
  }

  function handleTest() {
    setError(null);
    setSaved(false);
    setTestResult(null);
    startTestTransition(async () => {
      const result = await sendTestAlert(currentInput());

      const parts: string[] = [];
      if (result.emailSent) parts.push(t("testSentEmail"));
      if (result.teamsSent) parts.push(t("testSentTeams"));
      if (result.synthetic) parts.push(t("testSyntheticNotice"));

      if ("error" in result) {
        setError(resolveErrorMessage(result.error) || t("testFailed"));
      }
      if (parts.length > 0) {
        setTestResult(parts.join(" "));
      } else if (!("error" in result)) {
        setError(t("testFailed"));
      }
    });
  }

  return (
    <div>
      <h1 className="font-disp text-xl font-semibold text-ink">{t("title")}</h1>

      <div className="mt-3 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <input
            id="emailAlertsEnabled"
            type="checkbox"
            className="size-4"
            checked={emailAlertsEnabled}
            onChange={(event) => setEmailAlertsEnabled(event.target.checked)}
          />
          <Label htmlFor="emailAlertsEnabled">{t("emailLabel")}</Label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="teamsAlertsEnabled"
            type="checkbox"
            className="size-4"
            checked={teamsAlertsEnabled}
            onChange={(event) => setTeamsAlertsEnabled(event.target.checked)}
          />
          <Label htmlFor="teamsAlertsEnabled">{t("teamsLabel")}</Label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="teamsWebhookUrl">{t("teamsWebhookLabel")}</Label>
          <Input
            id="teamsWebhookUrl"
            value={teamsWebhookUrl}
            onChange={(event) => setTeamsWebhookUrl(event.target.value)}
            placeholder={t("teamsWebhookPlaceholder")}
            disabled={!teamsAlertsEnabled}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && !error && <p className="text-sm text-success">{t("saved")}</p>}
        {testResult && !error && <p className="text-sm text-ink-soft">{testResult}</p>}

        <div className="flex gap-2">
          <Button type="button" disabled={isSaving} onClick={handleSave}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" disabled={isTesting} onClick={handleTest}>
            {t("sendTest")}
          </Button>
        </div>
      </div>
    </div>
  );
}
