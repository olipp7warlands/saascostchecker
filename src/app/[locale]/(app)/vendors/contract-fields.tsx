"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SELECT_CLASSNAME =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ContractFields({
  idPrefix,
  defaultValues,
  includeStatus = false,
  departments,
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
  }>;
  includeStatus?: boolean;
  departments: { id: string; name: string }[];
}) {
  const t = useTranslations("Vendors.new");
  const tDetail = useTranslations("Vendors.detail");
  const d = defaultValues ?? {};

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
        <select
          id={`${idPrefix}-billingCycle`}
          name="billingCycle"
          required
          defaultValue={d.billingCycle ?? "annual"}
          className={SELECT_CLASSNAME}
        >
          <option value="monthly">{t("billingCycle.monthly")}</option>
          <option value="annual">{t("billingCycle.annual")}</option>
          <option value="one_time">{t("billingCycle.one_time")}</option>
        </select>
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-departmentId`}>{t("departmentLabel")}</Label>
        <select
          id={`${idPrefix}-departmentId`}
          name="departmentId"
          defaultValue={d.departmentId ?? ""}
          className={SELECT_CLASSNAME}
        >
          <option value="">{t("departmentNone")}</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </div>

      {includeStatus && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-status`}>{tDetail("statusLabel")}</Label>
          <select
            id={`${idPrefix}-status`}
            name="status"
            defaultValue={d.status ?? "active"}
            className={SELECT_CLASSNAME}
          >
            <option value="active">{tDetail("contractStatus.active")}</option>
            <option value="cancelled">{tDetail("contractStatus.cancelled")}</option>
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-document`}>{t("documentLabel")}</Label>
        <input id={`${idPrefix}-document`} name="document" type="file" accept="application/pdf" />
      </div>
    </>
  );
}
