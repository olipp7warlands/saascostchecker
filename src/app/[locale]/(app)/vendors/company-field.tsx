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
import { createCompany } from "@/features/companies/actions";

type Company = { id: string; name: string };

export function CompanyField({
  idPrefix,
  companies: initialCompanies,
  defaultValue,
  canCreate,
}: {
  idPrefix: string;
  companies: Company[];
  defaultValue?: string | null;
  canCreate: boolean;
}) {
  const t = useTranslations("Vendors.new");
  const tGeneric = useTranslations("Auth");
  const [companies, setCompanies] = useState(initialCompanies);
  const [value, setValue] = useState(defaultValue ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const name = String(formData.get("name") ?? "");
      const result = await createCompany({
        name,
        taxId: formData.get("taxId"),
        isDefault: false,
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      if (result.id) {
        setCompanies((prev) =>
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
        <Label htmlFor={`${idPrefix}-companyId`}>{t("companyLabel")}</Label>
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
              {t("addCompany")}
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>{t("companyDialog.title")}</DialogTitle>
              <form action={handleCreate} className="mt-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idPrefix}-new-company-name`}>
                    {t("companyDialog.nameLabel")}
                  </Label>
                  <Input id={`${idPrefix}-new-company-name`} name="name" required minLength={1} maxLength={200} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${idPrefix}-new-company-taxId`}>
                    {t("companyDialog.taxIdLabel")}
                  </Label>
                  <Input id={`${idPrefix}-new-company-taxId`} name="taxId" maxLength={50} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={isPending} className="self-start">
                  {t("companyDialog.submit")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Select name="companyId" value={value} onValueChange={(next) => setValue(next as string)}>
        <SelectTrigger id={`${idPrefix}-companyId`}>
          <SelectValue>
            {(current: string) =>
              current === "" ? t("companyNone") : (companies.find((c) => c.id === current)?.name ?? current)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{t("companyNone")}</SelectItem>
          {companies.map((company) => (
            <SelectItem key={company.id} value={company.id}>
              {company.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
