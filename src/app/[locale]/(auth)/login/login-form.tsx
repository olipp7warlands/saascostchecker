"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { signInWithGoogle, signInWithPassword } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GOOGLE_OAUTH_ENABLED } from "@/lib/feature-flags";

export function LoginForm({
  locale,
  oauthError,
}: {
  locale: "es" | "en";
  oauthError: boolean;
}) {
  const t = useTranslations("Auth.login");
  const tGeneric = useTranslations("Auth");
  const [error, setError] = useState<string | null>(
    oauthError ? t("errorOAuth") : null,
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signInWithPassword(locale, {
        email: formData.get("email"),
        password: formData.get("password"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-disp text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("tagline")}</p>
      </div>

      <form action={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <Input id="password" name="password" type="password" required />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={isPending} className="mt-2 w-full">
          {t("submit")}
        </Button>
      </form>

      {GOOGLE_OAUTH_ENABLED && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px flex-1 bg-line" />
            {t("orDivider")}
            <span className="h-px flex-1 bg-line" />
          </div>

          <form action={signInWithGoogle.bind(null, locale)}>
            <Button type="submit" variant="outline" className="w-full">
              {t("googleButton")}
            </Button>
          </form>
        </>
      )}

      <p className="text-center text-sm text-ink-soft">
        {t("noAccount")}{" "}
        <a href={`/${locale}/signup`} className="font-medium text-primary hover:underline">
          {t("signupLink")}
        </a>
      </p>
    </div>
  );
}
