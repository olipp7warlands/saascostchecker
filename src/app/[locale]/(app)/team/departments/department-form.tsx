"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDepartment } from "@/features/departments/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Member = { id: string; full_name: string | null; email: string };

export function DepartmentForm({ members }: { members: Member[] }) {
  const t = useTranslations("Team.departments");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createDepartment({
        name: formData.get("name"),
        managerUserId: formData.get("managerUserId"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1 className="font-disp text-xl font-semibold text-ink">{t("title")}</h1>

      <form action={handleSubmit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input id="name" name="name" required minLength={2} maxLength={120} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="managerUserId">{t("managerLabel")}</Label>
          <select
            id="managerUserId"
            name="managerUserId"
            defaultValue=""
            className="h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{t("noManager")}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={isPending} className="w-fit">
          {t("create")}
        </Button>
      </form>
    </div>
  );
}
