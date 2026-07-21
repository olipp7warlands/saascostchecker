"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExchangeRate } from "@/features/dashboard/types";
import { cancelContract } from "@/features/vendors/actions";
import { computeSavings } from "@/features/vendors/savings";
import type { BillingCycle } from "@/features/vendors/types";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CancelContractDialog({
  open,
  onOpenChange,
  contract,
  orgCurrency,
  rates,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: { id: string; costAmount: number; currency: string; billingCycle: string };
  orgCurrency: string;
  rates: ExchangeRate[];
  onSuccess: () => void;
}) {
  const t = useTranslations("Vendors.detail.cancelDialog");
  const tGeneric = useTranslations("Auth");

  const [closedAt, setClosedAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [savingsTouched, setSavingsTouched] = useState(false);
  const [savingsInput, setSavingsInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Eliminación total del gasto por defecto (newAnnualCost = 0) — editable
  // por si el usuario sustituyó el contrato por algo más barato fuera de
  // esta app.
  const suggested = useMemo(
    () =>
      computeSavings(
        contract.costAmount,
        contract.billingCycle as BillingCycle,
        contract.currency,
        0,
        contract.billingCycle as BillingCycle,
        contract.currency,
        orgCurrency,
        rates,
      ),
    [contract, orgCurrency, rates],
  );

  const displayedSavings = savingsTouched ? savingsInput : suggested.savingsAmount.toFixed(2);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelContract({
        contractId: contract.id,
        previousAnnualCost: suggested.previousAnnualCost,
        newAnnualCost: suggested.newAnnualCost,
        savingsAmount: Number(displayedSavings),
        orgCurrency,
        closedAt,
        notes,
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      onSuccess();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("title")}</DialogTitle>
        <p className="mt-1 text-sm text-ink-soft">{t("description")}</p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-savings">{t("savingsAmountLabel")}</Label>
            <Input
              id="cancel-savings"
              type="number"
              step="0.01"
              className="num"
              value={displayedSavings}
              onChange={(event) => {
                setSavingsTouched(true);
                setSavingsInput(event.target.value);
              }}
            />
            <p className="text-xs text-ink-soft">{t("suggestedSavingsHint")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-closedAt">{t("closedAtLabel")}</Label>
            <Input
              id="cancel-closedAt"
              type="date"
              value={closedAt}
              onChange={(event) => setClosedAt(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-notes">{t("notesLabel")}</Label>
            <Input id="cancel-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              {tGeneric("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleSubmit} disabled={isPending}>
              {t("submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
