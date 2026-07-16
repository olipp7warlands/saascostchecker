"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteContract, getContractDocumentUrl, updateContract } from "@/features/vendors/actions";
import type { BillingCycle } from "@/features/vendors/types";
import { ContractFields } from "../contract-fields";
import { ContractSeats, type SeatRow } from "./contract-seats";

type Contract = {
  id: string;
  name: string;
  cost_amount: number;
  currency: string;
  billing_cycle: string;
  seats_purchased: number | null;
  start_date: string;
  renewal_date: string;
  auto_renews: boolean;
  cancellation_notice_days: number;
  document_url: string | null;
  status: string;
  department_id: string | null;
  company_id: string | null;
};

type Member = { id: string; full_name: string | null; email: string };
type Department = { id: string; name: string };

export function ContractRow({
  contract,
  seats,
  members,
  departments,
  companies,
  canManageOrgDimensions,
}: {
  contract: Contract;
  seats: SeatRow[];
  members: Member[];
  departments: Department[];
  companies: Department[];
  canManageOrgDimensions: boolean;
}) {
  const t = useTranslations("Vendors.detail");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateContract({
        contractId: contract.id,
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
        status: formData.get("status"),
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
      const result = await deleteContract(contract.id);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
      setConfirmOpen(false);
    });
  }

  async function handleViewDocument() {
    setDocumentError(null);
    const result = await getContractDocumentUrl(contract.id);
    if ("error" in result) {
      setDocumentError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <li id={`contract-${contract.id}`} className="rounded-lg border border-line p-4">
      <form action={handleSave} className="flex flex-col gap-3">
        <ContractFields
          idPrefix={`contract-${contract.id}`}
          includeStatus
          departments={departments}
          companies={companies}
          canManageOrgDimensions={canManageOrgDimensions}
          defaultValues={{
            contractName: contract.name,
            costAmount: contract.cost_amount,
            currency: contract.currency,
            billingCycle: contract.billing_cycle,
            seatsPurchased: contract.seats_purchased,
            startDate: contract.start_date,
            renewalDate: contract.renewal_date,
            autoRenews: contract.auto_renews,
            cancellationNoticeDays: contract.cancellation_notice_days,
            status: contract.status,
            departmentId: contract.department_id,
            companyId: contract.company_id,
          }}
        />

        <div>
          {contract.document_url ? (
            <button
              type="button"
              onClick={handleViewDocument}
              className="text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
            >
              {t("viewDocument")}
            </button>
          ) : (
            <span className="text-sm text-ink-soft">{t("noDocument")}</span>
          )}
          {documentError && <p className="mt-1 text-sm text-destructive">{documentError}</p>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("deleteContract")}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmDeleteContractTitle")}
        description={t("confirmDeleteContract")}
        confirmLabel={t("deleteContract")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={handleDelete}
        isPending={isPending}
      />

      <ContractSeats
        contractId={contract.id}
        costAmount={contract.cost_amount}
        currency={contract.currency}
        billingCycle={contract.billing_cycle as BillingCycle}
        seatsPurchased={contract.seats_purchased}
        seats={seats}
        members={members}
      />
    </li>
  );
}
