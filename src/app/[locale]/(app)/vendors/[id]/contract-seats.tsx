"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { UtilizationBar } from "@/components/ui/utilization-bar";
import { assignSeat, setSeatActive, unassignSeat } from "@/features/vendors/actions";
import { annualizedCost } from "@/features/vendors/renewal";
import { seatUtilizationPct, utilizationTone, wastedSeatCost } from "@/features/vendors/seats";
import type { BillingCycle } from "@/features/vendors/types";

export type SeatRow = {
  id: string;
  userId: string;
  userName: string;
  active: boolean;
};

type Member = { id: string; full_name: string | null; email: string };

const SELECT_CLASSNAME =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ContractSeats({
  contractId,
  costAmount,
  currency,
  billingCycle,
  seatsPurchased,
  seats,
  members,
}: {
  contractId: string;
  costAmount: number;
  currency: string;
  billingCycle: BillingCycle;
  seatsPurchased: number | null;
  seats: SeatRow[];
  members: Member[];
}) {
  const t = useTranslations("Vendors.detail");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const assignedUserIds = new Set(seats.map((seat) => seat.userId));
  const eligibleMembers = members.filter((member) => !assignedUserIds.has(member.id));

  const activeSeats = seats.filter((seat) => seat.active).length;
  const pct = seatsPurchased != null ? seatUtilizationPct(activeSeats, seatsPurchased) : null;
  const wasted =
    seatsPurchased != null
      ? wastedSeatCost(annualizedCost(costAmount, billingCycle), seatsPurchased, activeSeats)
      : 0;
  const currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  function handleAssign(formData: FormData) {
    setError(null);
    setWarning(null);
    const userId = formData.get("userId");
    if (typeof userId !== "string" || !userId) {
      return;
    }
    startTransition(async () => {
      const result = await assignSeat({ contractId, userId });
      if ("error" in result && result.error) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      if (result.overCapacity) {
        setWarning(t("overCapacityWarning"));
      }
      router.refresh();
    });
  }

  function handleToggleActive(seat: SeatRow) {
    setError(null);
    startTransition(async () => {
      const result = await setSeatActive({ seatId: seat.id, active: !seat.active });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  function handleRemove(seat: SeatRow) {
    if (!window.confirm(t("confirmRemoveSeat"))) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await unassignSeat({ seatId: seat.id });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <h4 className="text-sm font-semibold text-ink">{t("seatsTitle")}</h4>

      {pct != null && (
        <div className="mt-2 flex items-center gap-2">
          <UtilizationBar pct={pct} tone={utilizationTone(pct)} />
          <span className="num text-xs text-ink-soft">
            {t("utilizationSummary", { active: activeSeats, purchased: seatsPurchased ?? 0, pct })}
          </span>
        </div>
      )}
      {pct != null && wasted > 0 && (
        <p className="num mt-1 text-xs text-[#B27A1E]">
          {t("wastedEstimate", { amount: currencyFormatter.format(wasted) })}
        </p>
      )}

      {seats.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {seats.map((seat) => (
            <li key={seat.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {seat.userName}
                <Pill tone={seat.active ? "green" : "neutral"}>
                  {seat.active ? t("seatStatus.active") : t("seatStatus.inactive")}
                </Pill>
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  disabled={isPending}
                  onClick={() => handleToggleActive(seat)}
                >
                  {seat.active ? t("markInactive") : t("markActive")}
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-destructive hover:underline"
                  disabled={isPending}
                  onClick={() => handleRemove(seat)}
                >
                  {t("removeSeat")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {warning && <p className="mt-2 text-xs text-[#B27A1E]">{warning}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {eligibleMembers.length > 0 ? (
        <form action={handleAssign} className="mt-3 flex items-center gap-2">
          <select name="userId" required defaultValue="" className={SELECT_CLASSNAME}>
            <option value="" disabled>
              {t("selectMemberPlaceholder")}
            </option>
            {eligibleMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={isPending}>
            {t("assignButton")}
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">{t("allMembersAssigned")}</p>
      )}
    </div>
  );
}
