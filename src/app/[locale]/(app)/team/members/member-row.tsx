"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateUserDepartment, updateUserRole } from "@/features/users/actions";

const ROLES = ["employee", "manager", "finance", "it_admin", "org_admin"] as const;

type Member = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  department_id: string | null;
};
type Department = { id: string; name: string };

export function MemberRow({
  member,
  departments,
}: {
  member: Member;
  departments: Department[];
}) {
  const t = useTranslations("Team.members");
  const tRoles = useTranslations("Auth.roles");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(role: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateUserRole({ userId: member.id, role });
      if (result && "error" in result) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDepartmentChange(departmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateUserDepartment({ userId: member.id, departmentId });
      if (result && "error" in result) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{member.full_name ?? member.email}</p>
          <p className="text-xs text-ink-soft">{member.email}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label={t("roleLabel")}
            defaultValue={member.role}
            disabled={isPending}
            onChange={(event) => handleRoleChange(event.target.value)}
            className="h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>

          <select
            aria-label={t("departmentLabel")}
            defaultValue={member.department_id ?? ""}
            disabled={isPending}
            onChange={(event) => handleDepartmentChange(event.target.value)}
            className="h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{t("noDepartment")}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}
