"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import type { ExchangeRate } from "@/features/dashboard/types";
import { pickPrimaryAction } from "@/features/vendors/primary-action";
import type { BillingCycle, VendorStatus } from "@/features/vendors/types";
import { ContractList } from "./contract-list";
import { DetailsTab } from "./details-tab";
import { DocumentsTab } from "./documents-tab";
import { NotesTab } from "./notes-tab";
import type { SeatRow } from "./contract-seats";
import { SeatsTab } from "./seats-tab";
import { VendorHeader } from "./vendor-header";
import { VendorRail } from "./vendor-rail";

type Vendor = {
  id: string;
  name: string;
  website: string;
  category: string;
  owner_user_id: string | null;
  status: string;
  notes: string | null;
};
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
  snoozed_until: string | null;
};
type Member = { id: string; full_name: string | null; email: string };
type Department = { id: string; name: string };

type OpenPanel = { type: "edit"; id: string } | { type: "add" } | null;

export function VendorFicha({
  locale,
  vendor,
  contracts,
  members,
  departments,
  companies,
  seatsByContract,
  canManageOrgDimensions,
  orgCurrency,
  rates,
  vendorSavingsTotal,
}: {
  locale: string;
  vendor: Vendor;
  contracts: Contract[];
  members: Member[];
  departments: Department[];
  companies: Department[];
  seatsByContract: Record<string, SeatRow[]>;
  canManageOrgDimensions: boolean;
  orgCurrency: string;
  rates: ExchangeRate[];
  vendorSavingsTotal: number;
}) {
  const t = useTranslations("Vendors.detail");
  const [activeTab, setActiveTab] = useState("details");
  const [vendorEditMode, setVendorEditMode] = useState(false);
  const [contractsSeed, setContractsSeed] = useState(0);
  const [contractsInitialPanel, setContractsInitialPanel] = useState<OpenPanel>(null);

  // Deep-links a un contrato concreto (dashboard, alertas de renovación por
  // email/Teams) apuntan a #contract-{id} dentro de esta ficha — sin esto, el
  // navegador intenta el scroll nativo mientras la pestaña Contratos sigue
  // sin montar (estado inicial "details"), y el ancla no lleva a ningún sitio.
  useEffect(() => {
    if (window.location.hash.startsWith("#contract-")) {
      setActiveTab("contracts");
    }
  }, []);

  const ownerMember = members.find((member) => member.id === vendor.owner_user_id) ?? null;
  const ownerName = ownerMember ? (ownerMember.full_name ?? ownerMember.email) : null;

  const primaryContract = useMemo(() => {
    const active = contracts.filter((c) => c.status === "active");
    if (active.length === 0) return null;
    return active.reduce((soonest, current) =>
      current.renewal_date < soonest.renewal_date ? current : soonest,
    );
  }, [contracts]);

  const companyName = primaryContract
    ? (companies.find((c) => c.id === primaryContract.company_id)?.name ?? null)
    : null;
  const departmentName = primaryContract
    ? (departments.find((d) => d.id === primaryContract.department_id)?.name ?? null)
    : null;

  const primaryAction = useMemo(
    () =>
      pickPrimaryAction(
        contracts.map((c) => ({
          id: c.id,
          status: c.status,
          renewalDate: c.renewal_date,
          autoRenews: c.auto_renews,
          cancellationNoticeDays: c.cancellation_notice_days,
        })),
      ),
    [contracts],
  );

  function openContractsPanel(panel: OpenPanel) {
    setActiveTab("contracts");
    setContractsInitialPanel(panel);
    setContractsSeed((seed) => seed + 1);
  }

  function handlePrimaryAction() {
    if (primaryAction.type === "addContract") {
      openContractsPanel({ type: "add" });
      return;
    }
    if (primaryAction.type === "renegotiate") {
      openContractsPanel({ type: "edit", id: primaryAction.contractId });
      return;
    }
    setActiveTab("details");
    setVendorEditMode(true);
  }

  const primaryLabel =
    primaryAction.type === "addContract"
      ? t("addContract")
      : primaryAction.type === "renegotiate"
        ? t("renegotiate")
        : t("edit");

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1">
        <VendorHeader
          name={vendor.name}
          website={vendor.website}
          status={vendor.status as VendorStatus}
          companyName={companyName}
          departmentName={departmentName}
          ownerName={ownerName}
          primaryLabel={primaryLabel}
          onPrimaryAction={handlePrimaryAction}
        />

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))} className="mt-6">
          <TabsList>
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="contracts">{t("tabs.contracts")}</TabsTrigger>
            <TabsTrigger value="seats">{t("tabs.seats")}</TabsTrigger>
            <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
            <TabsTrigger value="notes">{t("tabs.notes")}</TabsTrigger>
          </TabsList>

          <TabsPanel value="details" className="mt-5">
            <DetailsTab
              locale={locale}
              vendor={vendor}
              members={members}
              companyName={companyName}
              departmentName={departmentName}
              primaryContract={
                primaryContract
                  ? {
                      costAmount: primaryContract.cost_amount,
                      currency: primaryContract.currency,
                      billingCycle: primaryContract.billing_cycle as BillingCycle,
                      seatsPurchased: primaryContract.seats_purchased,
                      startDate: primaryContract.start_date,
                      renewalDate: primaryContract.renewal_date,
                      autoRenews: primaryContract.auto_renews,
                      cancellationNoticeDays: primaryContract.cancellation_notice_days,
                    }
                  : null
              }
              editMode={vendorEditMode}
              onToggleEdit={() => setVendorEditMode((mode) => !mode)}
            />
          </TabsPanel>

          <TabsPanel value="contracts" className="mt-5">
            <ContractList
              key={contractsSeed}
              vendorId={vendor.id}
              contracts={contracts}
              seatsByContract={seatsByContract}
              members={members}
              departments={departments}
              companies={companies}
              canManageOrgDimensions={canManageOrgDimensions}
              locale={locale}
              orgCurrency={orgCurrency}
              rates={rates}
              initialOpenPanel={contractsInitialPanel}
            />
          </TabsPanel>

          <TabsPanel value="seats" className="mt-5">
            <SeatsTab contracts={contracts} seatsByContract={seatsByContract} members={members} />
          </TabsPanel>

          <TabsPanel value="documents" className="mt-5">
            <DocumentsTab contracts={contracts} />
          </TabsPanel>

          <TabsPanel value="notes" className="mt-5">
            <NotesTab vendor={vendor} />
          </TabsPanel>
        </Tabs>
      </div>

      <div className="w-full shrink-0 lg:w-[280px]">
        <VendorRail
          locale={locale}
          contract={
            primaryContract
              ? {
                  costAmount: primaryContract.cost_amount,
                  currency: primaryContract.currency,
                  billingCycle: primaryContract.billing_cycle as BillingCycle,
                  renewalDate: primaryContract.renewal_date,
                  autoRenews: primaryContract.auto_renews,
                  cancellationNoticeDays: primaryContract.cancellation_notice_days,
                }
              : null
          }
          orgCurrency={orgCurrency}
          savingsTotal={vendorSavingsTotal}
        />
      </div>
    </div>
  );
}
