"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApprovalRuleScopeEditor, type TierData } from "./approval-rule-scope-editor";

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Department = { id: string; name: string };
type Member = { id: string; full_name: string | null; email: string };

// Personalizar un departamento arranca copiando los tramos GLOBALES vigentes
// como punto de partida editable — nada se persiste hasta el primer "Guardar"
// de ese editor (save_approval_rule_scope crea las filas del departamento en
// ese momento, no antes).
export function AddDepartmentOverride({
  locale,
  departments,
  globalTiers,
  members,
}: {
  locale: string;
  departments: Department[];
  globalTiers: TierData[];
  members: Member[];
}) {
  const t = useTranslations("Team.approvalRules");
  const [added, setAdded] = useState<Department[]>([]);
  const [selected, setSelected] = useState("");

  const available = departments.filter((dept) => !added.some((a) => a.id === dept.id));

  return (
    <div className="flex flex-col gap-4">
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className={SELECT_CLASSNAME}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{t("selectDepartmentToCustomize")}</option>
            {available.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selected}
            onClick={() => {
              const dept = departments.find((d) => d.id === selected);
              if (!dept) return;
              setAdded((prev) => [...prev, dept]);
              setSelected("");
            }}
          >
            {t("customizeForDepartment")}
          </Button>
        </div>
      )}

      {added.map((dept) => (
        <ApprovalRuleScopeEditor
          key={dept.id}
          locale={locale}
          departmentId={dept.id}
          departmentName={dept.name}
          initialTiers={globalTiers}
          members={members}
        />
      ))}
    </div>
  );
}
