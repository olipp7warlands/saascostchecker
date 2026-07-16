"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompanyField } from "./company-field";
import { DepartmentField } from "./department-field";

export function ContractFields({
  idPrefix,
  defaultValues,
  includeStatus = false,
  departments,
  companies,
  canManageOrgDimensions,
}: {
  idPrefix: string;
  defaultValues?: Partial<{
    contractName: string;
    costAmount: number;
    currency: string;
    billingCycle: string;
    seatsPurchased: number | null;
    startDate: string;
    renewalDate: string;
    autoRenews: boolean;
    cancellationNoticeDays: number;
    status: string;
    departmentId: string | null;
    companyId: string | null;
  }>;
  includeStatus?: boolean;
  departments: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  canManageOrgDimensions: boolean;
}) {
  const t = useTranslations("Vendors.new");
  const tDetail = useTranslations("Vendors.detail");
  const d = defaultValues ?? {};

  const billingCycleLabels: Record<string, string> = {
    monthly: t("billingCycle.monthly"),
    annual: t("billingCycle.annual"),
    one_time: t("billingCycle.one_time"),
  };
  const contractStatusLabels: Record<string, string> = {
    active: tDetail("contractStatus.active"),
    cancelled: tDetail("contractStatus.cancelled"),
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-contractName`}>{t("contractNameLabel")}</Label>
        <Input
          id={`${idPrefix}-contractName`}
          name="contractName"
          required
          minLength={1}
          maxLength={200}
          defaultValue={d.contractName}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-costAmount`}>{t("costLabel")}</Label>
          <Input
            id={`${idPrefix}-costAmount`}
            name="costAmount"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={d.costAmount}
          />
        </div>
        <div className="flex w-24 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-currency`}>{t("currencyLabel")}</Label>
          <Input
            id={`${idPrefix}-currency`}
            name="currency"
            required
            maxLength={3}
            defaultValue={d.currency ?? "EUR"}
            className="uppercase"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-billingCycle`}>{t("billingCycleLabel")}</Label>
        <Select name="billingCycle" defaultValue={d.billingCycle ?? "annual"} required>
          <SelectTrigger id={`${idPrefix}-billingCycle`}>
            <SelectValue>{(current: string) => billingCycleLabels[current] ?? current}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">{t("billingCycle.monthly")}</SelectItem>
            <SelectItem value="annual">{t("billingCycle.annual")}</SelectItem>
            <SelectItem value="one_time">{t("billingCycle.one_time")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-seatsPurchased`}>{t("seatsLabel")}</Label>
        <Input
          id={`${idPrefix}-seatsPurchased`}
          name="seatsPurchased"
          type="number"
          min={0}
          step="1"
          defaultValue={d.seatsPurchased ?? undefined}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-startDate`}>{t("startDateLabel")}</Label>
          <Input
            id={`${idPrefix}-startDate`}
            name="startDate"
            type="date"
            required
            defaultValue={d.startDate}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-renewalDate`}>{t("renewalDateLabel")}</Label>
          <Input
            id={`${idPrefix}-renewalDate`}
            name="renewalDate"
            type="date"
            required
            defaultValue={d.renewalDate}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`${idPrefix}-autoRenews`}
          name="autoRenews"
          type="checkbox"
          defaultChecked={d.autoRenews ?? true}
          className="size-4"
        />
        <Label htmlFor={`${idPrefix}-autoRenews`}>{t("autoRenewsLabel")}</Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-cancellationNoticeDays`}>{t("cancellationNoticeDaysLabel")}</Label>
        <Input
          id={`${idPrefix}-cancellationNoticeDays`}
          name="cancellationNoticeDays"
          type="number"
          min={0}
          step="1"
          required
          defaultValue={d.cancellationNoticeDays ?? 30}
        />
      </div>

      <CompanyField
        idPrefix={idPrefix}
        companies={companies}
        defaultValue={d.companyId}
        canCreate={canManageOrgDimensions}
      />

      <DepartmentField
        idPrefix={idPrefix}
        departments={departments}
        defaultValue={d.departmentId}
        canCreate={canManageOrgDimensions}
      />

      {includeStatus && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-status`}>{tDetail("statusLabel")}</Label>
          <Select name="status" defaultValue={d.status ?? "active"}>
            <SelectTrigger id={`${idPrefix}-status`}>
              <SelectValue>{(current: string) => contractStatusLabels[current] ?? current}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{tDetail("contractStatus.active")}</SelectItem>
              <SelectItem value="cancelled">{tDetail("contractStatus.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-document`}>{t("documentLabel")}</Label>
        <Input id={`${idPrefix}-document`} name="document" type="file" accept="application/pdf" />
      </div>
    </>
  );
}
