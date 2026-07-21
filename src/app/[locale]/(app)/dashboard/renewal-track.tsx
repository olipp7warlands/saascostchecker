import { getTranslations } from "next-intl/server";
import { AppLogo } from "@/components/catalog/app-logo";
import type { RenewalTicket } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";
import { TONE_CLASSES, TONE_TEXT_CLASSES } from "@/features/vendors/renewal-tone-classes";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 120;
const TICKS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 60, label: "60d" },
  { days: 90, label: "90d" },
  { days: 120, label: "120d" },
];

export async function RenewalTrack({
  tickets,
  locale,
}: {
  tickets: RenewalTicket[];
  locale: string;
}) {
  const t = await getTranslations("Shell.dashboard.runway");

  return (
    <div className="mt-6 rounded-[10px] border border-line bg-surface p-4 pb-6 sm:p-5 sm:pb-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="font-disp text-base font-semibold text-ink">{t("title")}</h2>
        <span className="text-xs text-ink-soft">{t("hint")}</span>
      </div>

      {tickets.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto pb-7">
          <div className="relative h-[118px] min-w-[640px] border-b border-line">
            {TICKS.map((tick) => (
              <div key={tick.days}>
                <div
                  className="absolute top-0 bottom-0 w-px bg-line"
                  style={{ left: `${(tick.days / WINDOW_DAYS) * 100}%` }}
                />
                <span
                  className="num absolute -bottom-[22px] -translate-x-1/2 text-[10.5px] text-ink-soft"
                  style={{ left: `${Math.min((tick.days / WINDOW_DAYS) * 100, 97)}%` }}
                >
                  {tick.label}
                </span>
              </div>
            ))}

            {tickets.map((ticket) => {
              const amountFormatter = new Intl.NumberFormat(locale, {
                style: "currency",
                currency: ticket.currency,
                maximumFractionDigits: 0,
              });

              return (
                <a
                  key={ticket.contractId}
                  href={buildContractPath(locale, ticket.vendorId, ticket.contractId)}
                  className={cn(
                    "absolute min-w-[118px] -translate-x-1/2 rounded-[7px] border px-2.5 py-1.5 shadow-sm",
                    TONE_CLASSES[ticket.tone],
                  )}
                  style={{ left: `${ticket.xPercent}%`, top: ticket.lane === 0 ? 6 : 60 }}
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <AppLogo
                      domain={ticket.vendorWebsite || null}
                      name={ticket.vendorName}
                      size={20}
                      className="rounded-[5px] p-0.5"
                    />
                    {ticket.vendorName}
                  </span>
                  <span className="num block text-[11.5px] text-ink-soft">
                    {t("perYear", { amount: amountFormatter.format(ticket.annualCost) })}
                  </span>
                  <div className={cn("num mt-0.5 text-[10.5px] font-semibold", TONE_TEXT_CLASSES[ticket.tone])}>
                    {ticket.daysUntil < 0
                      ? t("overdue", { days: Math.abs(ticket.daysUntil) })
                      : ticket.noticeWarning
                        ? t("noticeWarning", {
                            days: ticket.daysUntil,
                            noticeDays: ticket.cancellationNoticeDays,
                          })
                        : t("daysRemaining", { days: ticket.daysUntil })}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
