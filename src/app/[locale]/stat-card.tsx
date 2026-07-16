const STAT_TONE_CLASSES = {
  red: "text-destructive",
  amber: "text-[#B27A1E]",
  teal: "text-primary",
} as const;

export function StatCard({
  stat,
  title,
  body,
  tone,
}: {
  stat: string;
  title: string;
  body: string;
  tone: "red" | "amber" | "teal";
}) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-6.5">
      <div className={`num mb-2 text-[30px] font-semibold tracking-tight ${STAT_TONE_CLASSES[tone]}`}>
        {stat}
      </div>
      <b className="mb-2 block font-disp text-[17px] font-semibold text-ink">{title}</b>
      <p className="text-sm text-ink-soft">{body}</p>
    </div>
  );
}
