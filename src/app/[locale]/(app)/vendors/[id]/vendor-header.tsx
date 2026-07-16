"use client";

import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/catalog/app-logo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { VendorStatus } from "@/features/vendors/types";

const STATUS_TONE: Record<VendorStatus, PillTone> = {
  active: "green",
  trial: "amber",
  inactive: "neutral",
};

export function VendorHeader({
  name,
  website,
  status,
  companyName,
  departmentName,
  ownerName,
  primaryLabel,
  onPrimaryAction,
}: {
  name: string;
  website: string;
  status: VendorStatus;
  companyName: string | null;
  departmentName: string | null;
  ownerName: string | null;
  primaryLabel: string;
  onPrimaryAction: () => void;
}) {
  const t = useTranslations("Vendors.detail");
  const context = [companyName, departmentName].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3.5">
        <AppLogo domain={website} name={name} size={48} className="mt-0.5" />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
              {name}
            </h1>
            <Pill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Pill>
          </div>
          {context && <p className="text-sm text-ink-soft">{context}</p>}
          <div className="mt-1 flex items-center gap-2">
            <Avatar name={ownerName} size={22} />
            <span className="text-sm text-ink-soft">{ownerName ?? t("noOwnerAssigned")}</span>
          </div>
        </div>
      </div>

      <Button type="button" onClick={onPrimaryAction} className="shrink-0 sm:w-auto">
        {primaryLabel}
      </Button>
    </div>
  );
}
