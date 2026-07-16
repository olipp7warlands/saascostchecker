"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDepartment, updateDepartment } from "@/features/departments/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Member = { id: string; full_name: string | null; email: string };
type Department = { id: string; name: string; manager_user_id: string | null };

export function DepartmentRow({
  department,
  members,
}: {
  department: Department;
  members: Member[];
}) {
  const t = useTranslations("Team.departments");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateDepartment({
        departmentId: department.id,
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

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDepartment(department.id);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <form action={handleSave} className="flex flex-wrap items-center gap-2">
        <Input
          name="name"
          defaultValue={department.name}
          required
          minLength={2}
          maxLength={120}
          className="max-w-[10rem]"
        />
        <select
          name="managerUserId"
          defaultValue={department.manager_user_id ?? ""}
          className="h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">{t("noManager")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {t("edit")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={handleDelete}
        >
          {t("delete")}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}
