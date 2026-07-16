"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDepartment } from "@/features/departments/actions";

type Department = { id: string; name: string };

export function DepartmentField({
  idPrefix,
  departments: initialDepartments,
  defaultValue,
  canCreate,
}: {
  idPrefix: string;
  departments: Department[];
  defaultValue?: string | null;
  canCreate: boolean;
}) {
  const t = useTranslations("Vendors.new");
  const tGeneric = useTranslations("Auth");
  const [departments, setDepartments] = useState(initialDepartments);
  const [value, setValue] = useState(defaultValue ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const name = String(formData.get("name") ?? "");
      const result = await createDepartment({ name, managerUserId: null });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      if (result.id) {
        setDepartments((prev) =>
          [...prev, { id: result.id!, name }].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setValue(result.id);
      }
      setDialogOpen(false);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-departmentId`}>{t("departmentLabel")}</Label>
        {canCreate && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (open) {
                setError(null);
              }
            }}
          >
            <DialogTrigger className="text-xs font-medium text-ink underline underline-offset-4 hover:text-ink-soft">
              {t("addDepartment")}
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>{t("departmentDialog.title")}</DialogTitle>
              <form action={handleCreate} className="mt-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idPrefix}-new-department-name`}>
                    {t("departmentDialog.nameLabel")}
                  </Label>
                  <Input
                    id={`${idPrefix}-new-department-name`}
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={isPending} className="self-start">
                  {t("departmentDialog.submit")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Select name="departmentId" value={value} onValueChange={(next) => setValue(next as string)}>
        <SelectTrigger id={`${idPrefix}-departmentId`}>
          <SelectValue>
            {(current: string) =>
              current === "" ? t("departmentNone") : (departments.find((d) => d.id === current)?.name ?? current)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{t("departmentNone")}</SelectItem>
          {departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
