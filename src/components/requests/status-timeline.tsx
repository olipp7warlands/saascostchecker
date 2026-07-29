import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { getTimelineSteps, type PurchaseRequestStatus, type TimelineStepState } from "@/features/requests/timeline";
import { Pill, type PillTone } from "@/components/ui/pill";

const DOT_CLASS: Record<TimelineStepState, string> = {
  done: "bg-success",
  active: "bg-warning",
  rejected: "bg-destructive",
  cancelled: "bg-ink-soft",
  upcoming: "bg-muted",
};

const PILL_TONE: Record<TimelineStepState, PillTone> = {
  done: "green",
  active: "amber",
  rejected: "red",
  cancelled: "neutral",
  upcoming: "neutral",
};

export async function StatusTimeline({ status }: { status: PurchaseRequestStatus }) {
  const t = await getTranslations("Requests.detail.timeline");
  const steps = getTimelineSteps(status);

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <span className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[step.state])} aria-hidden="true" />
          <span className="flex-1 text-sm font-medium text-ink">{t(`step.${step.key}`)}</span>
          <Pill tone={PILL_TONE[step.state]}>{t(`state.${step.state}`)}</Pill>
        </li>
      ))}
    </ol>
  );
}
