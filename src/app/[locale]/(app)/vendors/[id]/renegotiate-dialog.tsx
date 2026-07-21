"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ExchangeRate } from "@/features/dashboard/types";
import { renegotiateContract } from "@/features/vendors/actions";
import { computeSavings } from "@/features/vendors/savings";
import type { BillingCycle } from "@/features/vendors/types";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RenegotiateDialog({
  open,
  onOpenChange,
  contract,
  orgCurrency,
  rates,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: { id: string; costAmount: number; currency: string; billingCycle: string; renewalDate: string };
  orgCurrency: string;
  rates: ExchangeRate[];
  onSuccess: () => void;
}) {
  const t = useTranslations("Vendors.detail.renegotiateDialog");
  const tNew = useTranslations("Vendors.new");
  const tGeneric = useTranslations("Auth");

  const [newCostAmount, setNewCostAmount] = useState(String(contract.costAmount));
  const [newCurrency, setNewCurrency] = useState(contract.currency);
  const [newBillingCycle, setNewBillingCycle] = useState(contract.billingCycle);
  const [newRenewalDate, setNewRenewalDate] = useState(contract.renewalDate);
  const [closedAt, setClosedAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [savingsTouched, setSavingsTouched] = useState(false);
  const [savingsInput, setSavingsInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggested = useMemo(
    () =>
      computeSavings(
        contract.costAmount,
        contract.billingCycle as BillingCycle,
        contract.currency,
        Number(newCostAmount) || 0,
        newBillingCycle as BillingCycle,
        newCurrency,
        orgCurrency,
        rates,
      ),
    [contract, newCostAmount, newBillingCycle, newCurrency, orgCurrency, rates],
  );

  const displayedSavings = savingsTouched ? savingsInput : suggested.savingsAmount.toFixed(2);

  const billingCycleLabels: Record<string, string> = {
    monthly: tNew("billingCycle.monthly"),
    annual: tNew("billingCycle.annual"),
    one_time: tNew("billingCycle.one_time"),
  };

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await renegotiateContract({
        contractId: contract.id,
        newCostAmount,
        newCurrency,
        newBillingCycle,
        newRenewalDate,
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renegotiate-costAmount">{tNew("costLabel")}</Label>
              <Input
                id="renegotiate-costAmount"
                type="number"
                min={0}
                step="0.01"
                value={newCostAmount}
                onChange={(event) => setNewCostAmount(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renegotiate-currency">{tNew("currencyLabel")}</Label>
              <Input
                id="renegotiate-currency"
                maxLength={3}
                className="uppercase"
                value={newCurrency}
                onChange={(event) => setNewCurrency(event.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renegotiate-billingCycle">{tNew("billingCycleLabel")}</Label>
            <Select value={newBillingCycle} onValueChange={(value) => setNewBillingCycle(String(value))}>
              <SelectTrigger id="renegotiate-billingCycle">
                <SelectValue>{(current: string) => billingCycleLabels[current] ?? current}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{tNew("billingCycle.monthly")}</SelectItem>
                <SelectItem value="annual">{tNew("billingCycle.annual")}</SelectItem>
                <SelectItem value="one_time">{tNew("billingCycle.one_time")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renegotiate-renewalDate">{tNew("renewalDateLabel")}</Label>
            <Input
              id="renegotiate-renewalDate"
              type="date"
              value={newRenewalDate}
              onChange={(event) => setNewRenewalDate(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renegotiate-savings">{t("savingsAmountLabel")}</Label>
            <Input
              id="renegotiate-savings"
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
            <Label htmlFor="renegotiate-closedAt">{t("closedAtLabel")}</Label>
            <Input
              id="renegotiate-closedAt"
              type="date"
              value={closedAt}
              onChange={(event) => setClosedAt(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renegotiate-notes">{t("notesLabel")}</Label>
            <Input id="renegotiate-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              {tGeneric("cancel")}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {t("submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
