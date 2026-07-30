"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resolvePurchaseRequestViaLink } from "@/features/requests/actions";

export function ApprovalDecisionForm({ token }: { token: string }) {
  const t = useTranslations("Requests.approvalLink");
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<"approved" | "rejected" | "error" | null>(null);

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const response = await resolvePurchaseRequestViaLink({
        token,
        decision,
        comment: decision === "rejected" ? comment : null,
      });
      setResult(response && "error" in response ? "error" : decision);
    });
  }

  // Mismo mensaje genérico que la página cuando el link ya no es válido en
  // el momento de decidir (usado/revocado entre la carga y el clic).
  if (result === "error") {
    return (
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-disp text-xl font-semibold text-ink">{t("invalidTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("invalidBody")}</p>
      </div>
    );
  }

  if (result === "approved" || result === "rejected") {
    return (
      <p className="text-center text-sm font-medium text-ink">
        {t(result === "approved" ? "doneApproved" : "doneRejected")}
      </p>
    );
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t("rejectionReasonPlaceholder")}
          className="rounded-input border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={isPending}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => decide("rejected")}
            disabled={isPending || comment.trim().length === 0}
          >
            {t("confirmReject")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button type="button" onClick={() => decide("approved")} disabled={isPending}>
        {t("approve")}
      </Button>
      <Button type="button" variant="destructive" onClick={() => setRejecting(true)} disabled={isPending}>
        {t("reject")}
      </Button>
    </div>
  );
}
