"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pill, type PillTone } from "@/components/ui/pill";
import { revokeApprovalDelegation } from "@/features/delegations/actions";

type Status = "active" | "upcoming" | "expired" | "revoked";

const STATUS_TONE: Record<Status, PillTone> = {
  active: "green",
  upcoming: "amber",
  expired: "neutral",
  revoked: "neutral",
};

export function DelegationRow({
  locale,
  id,
  startsOn,
  endsOn,
  status,
  label,
  canRevoke,
}: {
  locale: string;
  id: string;
  startsOn: string;
  endsOn: string;
  status: Status;
  label: string;
  canRevoke: boolean;
}) {
  const t = useTranslations("Settings.delegations");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeApprovalDelegation(locale, id);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setConfirmOpen(false);
        router.refresh();
      }
    });
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <Pill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Pill>
      </div>
      <p className="text-xs text-ink-soft">
        {dateFormatter.format(new Date(`${startsOn}T00:00:00`))} –{" "}
        {dateFormatter.format(new Date(`${endsOn}T00:00:00`))}
      </p>
      {canRevoke && status !== "revoked" && status !== "expired" && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="self-start"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {t("revoke")}
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmRevokeTitle")}
        description={t("confirmRevoke")}
        confirmLabel={t("revoke")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={handleRevoke}
        isPending={isPending}
      />
    </li>
  );
}
