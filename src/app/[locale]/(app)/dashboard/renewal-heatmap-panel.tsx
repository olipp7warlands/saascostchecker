"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/catalog/app-logo";
import type { RenewalHeatmapWeek, RenewalTicket } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";
import { TONE_TEXT_CLASSES } from "@/features/vendors/renewal-tone-classes";
import { cn } from "@/lib/utils";

function HeatmapTicketRow({
  ticket,
  locale,
  t,
}: {
  ticket: RenewalTicket;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const amountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: ticket.currency,
        maximumFractionDigits: 0,
      }),
    [locale, ticket.currency],
  );

  return (
    <li>
      <a
        href={buildContractPath(locale, ticket.vendorId, ticket.contractId)}
        className="flex items-center gap-2.5 rounded-[7px] border border-line bg-background px-2.5 py-2 hover:bg-muted"
      >
        <AppLogo
          domain={ticket.vendorWebsite || null}
          name={ticket.vendorName}
          size={20}
          className="shrink-0 rounded-[5px] p-0.5"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={ticket.vendorName}>
          {ticket.vendorName}
        </span>
        <span className="num shrink-0 text-[11.5px] text-ink-soft">
          {t("heatmap.perYear", { amount: amountFormatter.format(ticket.annualCost) })}
        </span>
        {/* Mismo criterio que la fila de la agenda anterior: vencido/preaviso
            siguen mostrando daysUntil bruto (tono rojo garantizado, sin
            contradicción posible); el caso general muestra actionableDaysUntil,
            la misma cifra que decide ticket.tone y la celda de la semana. */}
        <span className={cn("num shrink-0 text-[11px] font-semibold", TONE_TEXT_CLASSES[ticket.tone])}>
          {ticket.daysUntil < 0
            ? t("heatmap.overdue", { days: Math.abs(ticket.daysUntil) })
            : ticket.noticeWarning
              ? t("heatmap.noticeWarning", { days: ticket.daysUntil, noticeDays: ticket.cancellationNoticeDays })
              : t("heatmap.daysRemaining", { days: ticket.actionableDaysUntil })}
        </span>
      </a>
    </li>
  );
}

export function RenewalHeatmapPanel({
  week,
  locale,
  orgCurrency,
}: {
  week: RenewalHeatmapWeek | null;
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard");

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), [locale]);
  const totalFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: orgCurrency, maximumFractionDigits: 0 }),
    [locale, orgCurrency],
  );

  if (!week) {
    return (
      <section aria-label={t("heatmap.panelLabel")} className="rounded-[10px] border border-line bg-background p-3.5">
        <p className="text-[12.5px] text-ink-soft">{t("heatmap.panelEmptyRange")}</p>
      </section>
    );
  }

  const weekDateLabel = dateFormatter.format(new Date(`${week.weekStart}T00:00:00`));

  return (
    <section aria-label={t("heatmap.panelLabel")} className="rounded-[10px] border border-line bg-background p-3.5">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{t("heatmap.panelWeekLabel", { date: weekDateLabel })}</h3>
        {week.tickets.length > 0 && (
          <span className="num text-[12px] text-ink-soft">{totalFormatter.format(week.totalAnnualCostOrgCurrency)}</span>
        )}
      </div>

      {week.tickets.length === 0 ? (
        <p className="text-[12.5px] text-ink-soft">{t("heatmap.panelEmptyWeek")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {week.tickets.map((ticket) => (
            <HeatmapTicketRow key={ticket.contractId} ticket={ticket} locale={locale} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
