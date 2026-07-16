"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { Pill, type PillTone } from "@/components/ui/pill";
import { createContract, deleteContract, getContractDocumentUrl } from "@/features/vendors/actions";
import { annualizedCost, daysUntil, renewalTone } from "@/features/vendors/renewal";
import type { BillingCycle } from "@/features/vendors/types";
import { ContractFields } from "../contract-fields";
import { ContractRow } from "./contract-row";
import type { SeatRow } from "./contract-seats";

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

const RENEWAL_TONE_MAP: Record<string, PillTone> = { red: "red", amber: "amber", neutral: "neutral" };
const STATUS_TONE_MAP: Record<string, PillTone> = { active: "green", cancelled: "neutral" };

type OpenPanel = { type: "edit"; id: string } | { type: "add" } | null;

export function ContractList({
  vendorId,
  contracts,
  seatsByContract,
  members,
  departments,
  companies,
  canManageOrgDimensions,
  locale,
  initialOpenPanel = null,
}: {
  vendorId: string;
  contracts: Contract[];
  seatsByContract: Record<string, SeatRow[]>;
  members: Member[];
  departments: Department[];
  companies: Department[];
  canManageOrgDimensions: boolean;
  locale: string;
  initialOpenPanel?: OpenPanel;
}) {
  const t = useTranslations("Vendors.detail");
  const tNew = useTranslations("Vendors.new");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();

  const [openPanel, setOpenPanel] = useState<OpenPanel>(initialOpenPanel);
  const [dirty, setDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingPanel, setPendingPanel] = useState<OpenPanel>(null);
  const [contractPendingDelete, setContractPendingDelete] = useState<Contract | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function requestOpen(next: OpenPanel) {
    if (openPanel !== null && dirty) {
      setPendingPanel(next);
      setDiscardConfirmOpen(true);
      return;
    }
    setOpenPanel(next);
    setDirty(false);
  }

  function confirmDiscard() {
    setOpenPanel(pendingPanel);
    setDirty(false);
    setDiscardConfirmOpen(false);
  }

  function handleDelete() {
    if (!contractPendingDelete) return;
    startTransition(async () => {
      const result = await deleteContract(contractPendingDelete.id);
      if (!result || !("error" in result)) {
        if (openPanel?.type === "edit" && openPanel.id === contractPendingDelete.id) {
          setOpenPanel(null);
        }
        router.refresh();
      }
      setContractPendingDelete(null);
    });
  }

  async function handleViewDocument(contractId: string) {
    setDocumentError(null);
    const result = await getContractDocumentUrl(contractId);
    if ("error" in result) {
      setDocumentError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function handleAddSubmit(formData: FormData) {
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
      if (!result || !("error" in result)) {
        setOpenPanel(null);
        setDirty(false);
        router.refresh();
      }
    });
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const billingCycleLabels: Record<string, string> = {
    monthly: tNew("billingCycle.monthly"),
    annual: tNew("billingCycle.annual"),
    one_time: tNew("billingCycle.one_time"),
  };

  return (
    <div className="flex flex-col gap-3">
      {contracts.map((contract) => {
        const isEditing = openPanel?.type === "edit" && openPanel.id === contract.id;
        const isHistorical = contract.status !== "active";

        if (isEditing) {
          return (
            <div
              key={contract.id}
              onChangeCapture={() => setDirty(true)}
              className="rounded-lg border border-ink/20 bg-surface"
            >
              <div className="flex justify-end px-4 pt-3">
                <button
                  type="button"
                  onClick={() => requestOpen(null)}
                  className="text-sm font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
                >
                  {t("close")}
                </button>
              </div>
              <ContractRow
                contract={contract}
                seats={seatsByContract[contract.id] ?? []}
                members={members}
                departments={departments}
                companies={companies}
                canManageOrgDimensions={canManageOrgDimensions}
              />
            </div>
          );
        }

        return (
          <div
            key={contract.id}
            className={
              isHistorical
                ? "flex items-center gap-3 rounded-lg border border-line px-4 py-3 opacity-70"
                : "flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
            }
          >
            <div className="min-w-0 flex-1">
              <p className={isHistorical ? "truncate text-sm font-medium text-ink-soft" : "truncate text-sm font-medium text-ink"}>
                {contract.name}
              </p>
              <p className="num text-xs text-ink-soft">
                {new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency: contract.currency,
                  maximumFractionDigits: 0,
                }).format(annualizedCost(contract.cost_amount, contract.billing_cycle as BillingCycle))}
                {" · "}
                {billingCycleLabels[contract.billing_cycle]}
                {contract.seats_purchased != null && ` · ${contract.seats_purchased}`}
              </p>
            </div>

            {contract.status === "active" && (
              <Pill tone={RENEWAL_TONE_MAP[renewalTone(daysUntil(contract.renewal_date))]}>
                {dateFormatter.format(new Date(`${contract.renewal_date}T00:00:00`))} ·{" "}
                {daysUntil(contract.renewal_date)}d
              </Pill>
            )}
            <Pill tone={STATUS_TONE_MAP[contract.status] ?? "neutral"}>
              {contract.status === "active" ? t("activeBadge") : t("historicalBadge")}
            </Pill>

            <KebabMenu
              label={t("actions")}
              items={[
                { label: t("edit"), onClick: () => requestOpen({ type: "edit", id: contract.id }) },
                {
                  label: t("viewDocument"),
                  onClick: () => handleViewDocument(contract.id),
                  disabled: !contract.document_url,
                },
                {
                  label: t("deleteContract"),
                  onClick: () => setContractPendingDelete(contract),
                  destructive: true,
                },
              ]}
            />
          </div>
        );
      })}

      {documentError && <p className="text-sm text-destructive">{documentError}</p>}

      {openPanel?.type === "add" ? (
        <div onChangeCapture={() => setDirty(true)} className="rounded-lg border border-dashed border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{t("addContract")}</h3>
            <button
              type="button"
              onClick={() => requestOpen(null)}
              className="text-sm font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              {t("close")}
            </button>
          </div>
          <form action={handleAddSubmit} className="flex flex-col gap-3">
            <ContractFields
              idPrefix="add"
              departments={departments}
              companies={companies}
              canManageOrgDimensions={canManageOrgDimensions}
            />
            <Button type="submit" disabled={isPending} className="self-start">
              {t("addContract")}
            </Button>
          </form>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => requestOpen({ type: "add" })} className="self-start">
          {t("addContract")}
        </Button>
      )}

      <ConfirmDialog
        open={contractPendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setContractPendingDelete(null);
        }}
        title={t("confirmDeleteContractTitle")}
        description={t("confirmDeleteContract")}
        confirmLabel={t("deleteContract")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={handleDelete}
        isPending={isPending}
      />

      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={t("discardChangesTitle")}
        description={t("discardChanges")}
        confirmLabel={t("discard")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}
