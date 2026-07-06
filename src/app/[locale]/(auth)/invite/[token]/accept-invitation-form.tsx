"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptInvitation } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AcceptInvitationForm({
  locale,
  token,
  orgName,
  email,
  roleLabel,
}: {
  locale: "es" | "en";
  token: string;
  orgName: string;
  email: string;
  roleLabel: string;
}) {
  const t = useTranslations("Auth.invite");
  const tGeneric = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(locale, {
        token,
        fullName: formData.get("fullName"),
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
        <h1 className="font-disp text-2xl font-semibold text-ink">
          {t("title", { orgName })}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t("tagline", { role: roleLabel })}</p>
      </div>

      <form action={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" value={email} disabled readOnly />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">{t("fullNameLabel")}</Label>
          <Input id="fullName" name="fullName" required minLength={2} maxLength={120} />
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
    </div>
  );
}
