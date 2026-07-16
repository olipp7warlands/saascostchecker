"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createContract } from "@/features/vendors/actions";
import { ContractFields } from "../contract-fields";

type Department = { id: string; name: string };

export function NewContractForm({
  vendorId,
  departments,
  companies,
  canManageOrgDimensions,
}: {
  vendorId: string;
  departments: Department[];
  companies: Department[];
  canManageOrgDimensions: boolean;
}) {
  const t = useTranslations("Vendors.detail");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createContract({
        vendorId,
        contractName: formData.get("contractName"),
        costAmount: formData.get("costAmount"),
        currency: formData.get("currency"),
        billingCycle: formData.get("billingCycle"),
        seatsPurchased: formData.get("seatsPurchased"),
        startDate: formData.get("startDate"),
        renewalDate: formData.get("renewalDate"),
        autoRenews: formData.get("autoRenews") === "on",
        cancellationNoticeDays: formData.get("cancellationNoticeDays"),
        departmentId: formData.get("departmentId"),
        companyId: formData.get("companyId"),
        document: formData.get("document"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <ContractFields
        idPrefix="add"
        departments={departments}
        companies={companies}
        canManageOrgDimensions={canManageOrgDimensions}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={isPending} className="self-start">
        {t("addContract")}
      </Button>
    </form>
  );
}
