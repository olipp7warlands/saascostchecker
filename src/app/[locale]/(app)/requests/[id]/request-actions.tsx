"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  cancelPurchaseRequest,
  markPurchaseRequestPurchased,
  resolvePurchaseRequest,
} from "@/features/requests/actions";
import type { PurchaseRequestStatus } from "@/features/requests/timeline";

export function RequestActions({
  locale,
  requestId,
  status,
  canApprove,
  isRequester,
}: {
  locale: string;
  requestId: string;
  status: PurchaseRequestStatus;
  canApprove: boolean;
  isRequester: boolean;
}) {
  const t = useTranslations("Requests.detail.actions");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await resolvePurchaseRequest(locale, {
        requestId,
        decision: "approved",
        rejectionReason: null,
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const result = await resolvePurchaseRequest(locale, {
        requestId,
        decision: "rejected",
        rejectionReason,
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setRejectOpen(false);
        router.refresh();
      }
    });
  }

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelPurchaseRequest(locale, requestId);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setCancelOpen(false);
        router.refresh();
      }
    });
  }

  function handleMarkPurchased() {
    setError(null);
    startTransition(async () => {
      const result = await markPurchaseRequestPurchased(locale, requestId);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  const showApproveReject = status === "pending" && canApprove;
  const showCancel = status === "pending" && isRequester && !canApprove;
  const showMarkPurchased = status === "approved" && (isRequester || canApprove);

  if (!showApproveReject && !showCancel && !showMarkPurchased) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {showApproveReject && (
        <div className="flex gap-2">
          <Button type="button" onClick={handleApprove} disabled={isPending}>
            {t("approve")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
          >
            {t("reject")}
          </Button>
        </div>
      )}

      {showCancel && (
        <Button type="button" variant="outline" onClick={() => setCancelOpen(true)} disabled={isPending}>
          {t("cancel")}
        </Button>
      )}

      {showMarkPurchased && (
        <Button type="button" variant="outline" onClick={handleMarkPurchased} disabled={isPending}>
          {t("markPurchased")}
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogTitle>{t("rejectDialogTitle")}</DialogTitle>
          <DialogDescription>{t("rejectDialogDescription")}</DialogDescription>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="rejection-reason">{t("rejectionReasonPlaceholder")}</Label>
            <textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={3}
              maxLength={2000}
              className="rounded-input border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={isPending}>
              {t("rejectDialogCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || rejectionReason.trim().length === 0}
            >
              {t("rejectDialogConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelDialogTitle")}
        description={t("cancelDialogDescription")}
        confirmLabel={t("cancelDialogConfirm")}
        cancelLabel={t("cancelDialogCancel")}
        onConfirm={handleCancel}
        isPending={isPending}
      />
    </div>
  );
}
