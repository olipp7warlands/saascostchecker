"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { signInWithGoogle, signUpOrganization } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignUpForm({ locale }: { locale: "es" | "en" }) {
  const t = useTranslations("Auth.signup");
  const tGeneric = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signUpOrganization({
        orgName: formData.get("orgName"),
        orgSlug: formData.get("orgSlug"),
        defaultCurrency: formData.get("defaultCurrency"),
        locale,
        fullName: formData.get("fullName"),
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
          <Label htmlFor="orgName">{t("orgNameLabel")}</Label>
          <Input id="orgName" name="orgName" required minLength={2} maxLength={120} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgSlug">{t("orgSlugLabel")}</Label>
          <Input
            id="orgSlug"
            name="orgSlug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title={t("orgSlugHint")}
          />
          <p className="text-xs text-ink-soft">{t("orgSlugHint")}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defaultCurrency">{t("defaultCurrencyLabel")}</Label>
          <Input
            id="defaultCurrency"
            name="defaultCurrency"
            required
            maxLength={3}
            defaultValue="EUR"
            className="uppercase"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">{t("fullNameLabel")}</Label>
          <Input id="fullName" name="fullName" required minLength={2} maxLength={120} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <Input id="password" name="password" type="password" required minLength={8} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={isPending} className="mt-2 w-full">
          {t("submit")}
        </Button>
      </form>

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

      <p className="text-center text-sm text-ink-soft">
        {t("haveAccount")}{" "}
        <a href={`/${locale}/login`} className="font-medium text-primary hover:underline">
          {t("loginLink")}
        </a>
      </p>
    </div>
  );
}
