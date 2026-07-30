import { getTranslations } from "next-intl/server";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { Role } from "@/features/auth/session";

export type ApprovalStepStatus = "queued" | "pending" | "approved" | "rejected" | "skipped" | "escalated_to_org_admin";
export type ApprovalStepResolvedVia = "rule" | "fallback_no_manager" | "escalated_timeout" | "reassigned_self_approval";

export type ApprovalStepView = {
  stepOrder: number;
  status: ApprovalStepStatus;
  approverRole: Role | null;
  approverName: string | null;
  resolvedVia: ApprovalStepResolvedVia | null;
};

const STATUS_TONE: Record<ApprovalStepStatus, PillTone> = {
  queued: "neutral",
  pending: "amber",
  approved: "green",
  rejected: "red",
  skipped: "neutral",
  escalated_to_org_admin: "amber",
};

// Auto-tier no materializa pasos (0 filas) — el rail simplemente no se
// renderiza, StatusTimeline ya cuenta la historia completa en ese caso.
export async function ApprovalSteps({ steps }: { steps: ApprovalStepView[] }) {
  if (steps.length === 0) {
    return null;
  }

  const t = await getTranslations("Requests.detail.steps");
  const tRoles = await getTranslations("Auth.roles");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">{t("title")}</p>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.stepOrder}
            className="flex flex-col gap-0.5 border-b border-line pb-2 last:border-0 last:pb-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">
                {t("stepLabel", { order: step.stepOrder })}:{" "}
                {step.approverName ?? (step.approverRole ? tRoles(step.approverRole) : t("unknownApprover"))}
              </span>
              <Pill tone={STATUS_TONE[step.status]}>{t(`status.${step.status}`)}</Pill>
            </div>
            {step.resolvedVia === "fallback_no_manager" && (
              <p className="text-xs text-ink-soft">{t("fallbackNoManager")}</p>
            )}
            {step.resolvedVia === "escalated_timeout" && (
              <p className="text-xs text-ink-soft">{t("escalatedTimeout")}</p>
            )}
            {step.resolvedVia === "reassigned_self_approval" && (
              <p className="text-xs text-ink-soft">{t("reassignedSelfApproval")}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
