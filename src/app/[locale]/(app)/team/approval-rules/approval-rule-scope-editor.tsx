"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { restoreDefaultApprovalRules, saveApprovalRuleScope } from "@/features/approval-rules/actions";

const APPROVER_ROLES = ["employee", "manager", "finance", "it_admin", "org_admin"] as const;

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ApproverType = "auto" | "manager_of_requester" | "role" | "specific_user";

export type TierData = {
  maxAmount: number | null;
  steps: { approverType: ApproverType; approverRole: string | null; approverUserId: string | null }[];
};

type StepDraft = { approverType: ApproverType; approverRole: string; approverUserId: string };
type TierDraft = { maxAmount: string; steps: StepDraft[] };

type Member = { id: string; full_name: string | null; email: string };

function toDrafts(tiers: TierData[]): TierDraft[] {
  return tiers.map((tier) => ({
    maxAmount: tier.maxAmount === null ? "" : String(tier.maxAmount),
    steps: tier.steps.map((step) => ({
      approverType: step.approverType,
      approverRole: step.approverRole ?? "org_admin",
      approverUserId: step.approverUserId ?? "",
    })),
  }));
}

export function ApprovalRuleScopeEditor({
  locale,
  departmentId,
  departmentName,
  initialTiers,
  members,
}: {
  locale: string;
  departmentId: string | null;
  departmentName: string | null;
  initialTiers: TierData[];
  members: Member[];
}) {
  const t = useTranslations("Team.approvalRules");
  const tRoles = useTranslations("Auth.roles");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [tiers, setTiers] = useState<TierDraft[]>(() => toDrafts(initialTiers));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [restoreOpen, setRestoreOpen] = useState(false);

  function updateTierMax(index: number, value: string) {
    setTiers((prev) => prev.map((tier, i) => (i === index ? { ...tier, maxAmount: value } : tier)));
  }

  function updateStep(tierIndex: number, stepIndex: number, patch: Partial<StepDraft>) {
    setTiers((prev) =>
      prev.map((tier, i) =>
        i !== tierIndex
          ? tier
          : { ...tier, steps: tier.steps.map((step, j) => (j !== stepIndex ? step : { ...step, ...patch })) },
      ),
    );
  }

  function addStep(tierIndex: number) {
    setTiers((prev) =>
      prev.map((tier, i) =>
        i !== tierIndex
          ? tier
          : { ...tier, steps: [...tier.steps, { approverType: "role", approverRole: "org_admin", approverUserId: "" }] },
      ),
    );
  }

  function removeStep(tierIndex: number, stepIndex: number) {
    setTiers((prev) =>
      prev.map((tier, i) => (i !== tierIndex ? tier : { ...tier, steps: tier.steps.filter((_, j) => j !== stepIndex) })),
    );
  }

  function addTier() {
    setTiers((prev) => {
      const last = prev[prev.length - 1];
      const prevBoundary = prev.length > 1 ? Number(prev[prev.length - 2].maxAmount || 0) : 0;
      const suggested = String(prevBoundary + 1000);
      return [
        ...prev.slice(0, -1),
        { ...last, maxAmount: suggested },
        { maxAmount: "", steps: [{ approverType: "role", approverRole: "org_admin", approverUserId: "" }] },
      ];
    });
  }

  function removeTier() {
    setTiers((prev) => {
      if (prev.length <= 1) return prev;
      return [...prev.slice(0, -2), { ...prev[prev.length - 2], maxAmount: "" }];
    });
  }

  function handleSave() {
    setError(null);
    const payload = {
      departmentId,
      tiers: tiers.map((tier, index) => ({
        maxAmount: index === tiers.length - 1 ? null : Number(tier.maxAmount),
        steps: tier.steps.map((step) => {
          if (step.approverType === "role") {
            return { approverType: "role" as const, approverRole: step.approverRole as (typeof APPROVER_ROLES)[number] };
          }
          if (step.approverType === "specific_user") {
            return { approverType: "specific_user" as const, approverUserId: step.approverUserId };
          }
          return { approverType: step.approverType };
        }),
      })),
    };

    startTransition(async () => {
      const result = await saveApprovalRuleScope(locale, payload);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreDefaultApprovalRules(locale, departmentId);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        setRestoreOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-disp text-base font-semibold text-ink">{departmentName ?? t("globalScope")}</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => setRestoreOpen(true)} disabled={isPending}>
          {departmentId ? t("removeOverrides") : t("restoreDefaults")}
        </Button>
      </div>

      <ol className="mt-3 flex flex-col gap-3">
        {tiers.map((tier, tierIndex) => {
          const minAmount = tierIndex === 0 ? 0 : Number(tiers[tierIndex - 1].maxAmount || 0);
          const isLastTier = tierIndex === tiers.length - 1;
          const hasAutoStep = tier.steps.some((step) => step.approverType === "auto");

          return (
            <li key={tierIndex} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="num">{minAmount}</span>
                <span>–</span>
                {isLastTier ? (
                  <span>{t("noLimit")}</span>
                ) : (
                  <Input
                    type="number"
                    min={minAmount + 1}
                    className="w-28"
                    value={tier.maxAmount}
                    onChange={(event) => updateTierMax(tierIndex, event.target.value)}
                  />
                )}
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {tier.steps.map((step, stepIndex) => (
                  <div key={stepIndex} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                      {t("stepLabel", { order: stepIndex + 1 })}
                    </span>
                    <select
                      className={SELECT_CLASSNAME}
                      value={step.approverType}
                      onChange={(event) =>
                        updateStep(tierIndex, stepIndex, { approverType: event.target.value as ApproverType })
                      }
                    >
                      <option value="auto">{t("approverType.auto")}</option>
                      <option value="manager_of_requester">{t("approverType.managerOfRequester")}</option>
                      <option value="role">{t("approverType.role")}</option>
                      <option value="specific_user">{t("approverType.specificUser")}</option>
                    </select>
                    {step.approverType === "role" && (
                      <select
                        className={SELECT_CLASSNAME}
                        value={step.approverRole}
                        onChange={(event) => updateStep(tierIndex, stepIndex, { approverRole: event.target.value })}
                      >
                        {APPROVER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {tRoles(role)}
                          </option>
                        ))}
                      </select>
                    )}
                    {step.approverType === "specific_user" && (
                      <select
                        className={SELECT_CLASSNAME}
                        value={step.approverUserId}
                        onChange={(event) => updateStep(tierIndex, stepIndex, { approverUserId: event.target.value })}
                      >
                        <option value="">{t("selectUser")}</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.full_name ?? member.email}
                          </option>
                        ))}
                      </select>
                    )}
                    {tier.steps.length > 1 && (
                      <Button type="button" variant="link" size="sm" onClick={() => removeStep(tierIndex, stepIndex)}>
                        {t("removeStep")}
                      </Button>
                    )}
                  </div>
                ))}
                {!hasAutoStep && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => addStep(tierIndex)}
                  >
                    {t("addStep")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addTier} disabled={isPending}>
          {t("addTier")}
        </Button>
        {tiers.length > 1 && (
          <Button type="button" variant="outline" size="sm" onClick={removeTier} disabled={isPending}>
            {t("removeTier")}
          </Button>
        )}
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending} className="ml-auto">
          {t("save")}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={departmentId ? t("confirmRemoveOverridesTitle") : t("confirmRestoreTitle")}
        description={departmentId ? t("confirmRemoveOverrides") : t("confirmRestore")}
        confirmLabel={departmentId ? t("removeOverrides") : t("restoreDefaults")}
        cancelLabel={tGeneric("cancel")}
        onConfirm={handleRestore}
        isPending={isPending}
      />
    </div>
  );
}
