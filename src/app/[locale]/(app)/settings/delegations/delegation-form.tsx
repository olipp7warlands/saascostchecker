"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApprovalDelegation } from "@/features/delegations/actions";

type Member = { id: string; full_name: string | null; email: string };

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function DelegationForm({
  locale,
  delegatorUserId,
  members,
}: {
  locale: string;
  delegatorUserId: string;
  members: Member[];
}) {
  const t = useTranslations("Settings.delegations");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createApprovalDelegation(locale, {
        delegatorUserId,
        delegateUserId: formData.get("delegateUserId"),
        startsOn: formData.get("startsOn"),
        endsOn: formData.get("endsOn"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
        (document.getElementById("delegation-form") as HTMLFormElement | null)?.reset();
      }
    });
  }

  const candidates = members.filter((member) => member.id !== delegatorUserId);

  return (
    <form id="delegation-form" action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="delegateUserId">{t("delegateLabel")}</Label>
        <select id="delegateUserId" name="delegateUserId" required className={SELECT_CLASSNAME} defaultValue="">
          <option value="" disabled>
            {t("selectDelegate")}
          </option>
          {candidates.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startsOn">{t("startsOnLabel")}</Label>
          <Input id="startsOn" name="startsOn" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endsOn">{t("endsOnLabel")}</Label>
          <Input id="endsOn" name="endsOn" type="date" required />
        </div>
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {t("create")}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
