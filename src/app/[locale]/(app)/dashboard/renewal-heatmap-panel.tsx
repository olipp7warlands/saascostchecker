"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/catalog/app-logo";
import { summarizeRenewalTickets } from "@/features/dashboard/aggregate";
import type { RenewalHeatmapSelection, RenewalTicket } from "@/features/dashboard/types";
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
        className="flex flex-col gap-1 rounded-[7px] border border-line bg-background px-2.5 py-2 hover:bg-muted"
      >
        {/* Línea 1: solo logo+nombre — el nombre nunca compite por ancho con
            el coste/badge de estado (bug real visto en captura: con las 3
            piezas en una sola línea, el nombre quedaba casi sin espacio pese
            al truncate). */}
        <div className="flex items-center gap-2">
          <AppLogo
            domain={ticket.vendorWebsite || null}
            name={ticket.vendorName}
            size={18}
            className="shrink-0 rounded-[5px] p-0.5"
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={ticket.vendorName}>
            {ticket.vendorName}
          </span>
        </div>
        {/* Línea 2: coste + estado, indentados bajo el nombre (18px logo + 8px gap). */}
        <div className="flex items-center justify-between gap-2 pl-[26px]">
          <span className="num shrink-0 text-[11.5px] text-ink-soft">
            {t("heatmap.perYear", { amount: amountFormatter.format(ticket.annualCost) })}
          </span>
          {/* Mismo criterio que antes: vencido/preaviso siguen mostrando
              daysUntil bruto (tono rojo garantizado, sin contradicción
              posible); el caso general muestra actionableDaysUntil, la misma
              cifra que decide ticket.tone y la celda del día. */}
          <span className={cn("num shrink-0 text-[11px] font-semibold", TONE_TEXT_CLASSES[ticket.tone])}>
            {ticket.daysUntil < 0
              ? t("heatmap.overdue", { days: Math.abs(ticket.daysUntil) })
              : ticket.noticeWarning
                ? t("heatmap.noticeWarning", { days: ticket.daysUntil, noticeDays: ticket.cancellationNoticeDays })
                : t("heatmap.daysRemaining", { days: ticket.actionableDaysUntil })}
          </span>
        </div>
      </a>
    </li>
  );
}

export function RenewalHeatmapPanel({
  tickets,
  selection,
  locale,
  orgCurrency,
}: {
  tickets: RenewalTicket[];
  selection: RenewalHeatmapSelection;
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard");

  // Año siempre incluido — mismo motivo que cellDateFormatter en
  // renewal-heatmap.tsx: el horizonte de 12 meses hace que el día de "hoy" y
  // el último día del grid compartan día+mes.
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }),
    [locale],
  );
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const totalFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: orgCurrency, maximumFractionDigits: 0 }),
    [locale, orgCurrency],
  );

  const headerLabel =
    selection.kind === "day"
      ? t("heatmap.panelDayLabel", { date: dayFormatter.format(new Date(`${selection.date}T00:00:00`)) })
      : t("heatmap.panelMonthLabel", { month: monthFormatter.format(new Date(selection.year, selection.month, 1)) });

  const summary = summarizeRenewalTickets(tickets);

  return (
    <section aria-label={t("heatmap.panelLabel")} className="rounded-[10px] border border-line bg-background p-3.5">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink capitalize">{headerLabel}</h3>
        {tickets.length > 0 && (
          <span className="num text-[12px] text-ink-soft">
            {totalFormatter.format(summary.totalAnnualCostOrgCurrency)}
          </span>
        )}
      </div>

      {tickets.length === 0 ? (
        <p className="text-[12.5px] text-ink-soft">{t("heatmap.panelEmptyPeriod")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tickets.map((ticket) => (
            <HeatmapTicketRow key={ticket.contractId} ticket={ticket} locale={locale} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
