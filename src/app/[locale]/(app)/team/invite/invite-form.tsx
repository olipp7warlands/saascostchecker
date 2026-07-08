"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createInvitation } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROLES = ["employee", "manager", "finance", "it_admin", "org_admin"] as const;

export function InviteForm({
  locale,
  orgName,
}: {
  locale: "es" | "en";
  orgName: string;
}) {
  const t = useTranslations("Team.invite");
  const tGeneric = useTranslations("Auth");
  const tRoles = useTranslations("Auth.roles");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await createInvitation(orgName, locale, {
        email: formData.get("email"),
        role: formData.get("role"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setSent(true);
      }
    });
  }

  return (
    <div>
      <h1 className="font-disp text-xl font-semibold text-ink">{t("title")}</h1>

      <form action={handleSubmit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">{t("roleLabel")}</Label>
          <select
            id="role"
            name="role"
            defaultValue="employee"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {sent && <p className="text-sm text-primary">{t("sentConfirmation")}</p>}

        <Button type="submit" disabled={isPending} className="w-fit">
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
