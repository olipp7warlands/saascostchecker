"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ContractFields } from "@/app/[locale]/(app)/vendors/contract-fields";
import { Button } from "@/components/ui/button";
import { createContract } from "@/features/vendors/actions";

type Department = { id: string; name: string };

export function AddContractForRequestForm({
  locale,
  requestId,
  vendorId,
  departments,
  companies,
  canManageOrgDimensions,
  defaultValues,
}: {
  locale: string;
  requestId: string;
  vendorId: string;
  departments: Department[];
  companies: Department[];
  canManageOrgDimensions: boolean;
  defaultValues: {
    contractName: string;
    costAmount: number;
    currency: string;
    departmentId: string | null;
  };
}) {
  const t = useTranslations("Requests.convert.existing");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createContract({
        vendorId,
        sourceRequestId: requestId,
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
        return;
      }
      router.push(`/${locale}/vendors/${vendorId}`);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <ContractFields
          idPrefix="convert"
          defaultValues={defaultValues}
          departments={departments}
          companies={companies}
          canManageOrgDimensions={canManageOrgDimensions}
        />
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}
