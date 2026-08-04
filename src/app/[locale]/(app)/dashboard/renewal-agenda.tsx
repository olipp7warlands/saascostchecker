"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/catalog/app-logo";
import { Button } from "@/components/ui/button";
import { SegmentedControlItem, SegmentedControlList } from "@/components/ui/segmented-control";
import { Tabs } from "@/components/ui/tabs";
import { groupRenewalTicketsByTier } from "@/features/dashboard/aggregate";
import type { RenewalAgendaTier, RenewalTicket, RenewalTierKey } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";
import { TONE_TEXT_CLASSES } from "@/features/vendors/renewal-tone-classes";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [30, 60, 90, 120];
const UPCOMING_VISIBLE = 5;

// Mismo tono que ya trae cada ticket (`renewalTone`) — solo renombrado al
// vocabulario de tramo de la agenda (crítico/próximo/estable).
const TIER_TONE_CLASS: Record<RenewalTierKey, string> = {
  critical: TONE_TEXT_CLASSES.red,
  upcoming: TONE_TEXT_CLASSES.amber,
  stable: TONE_TEXT_CLASSES.neutral,
};

function TicketRow({
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
          {t("runway.perYear", { amount: amountFormatter.format(ticket.annualCost) })}
        </span>
        {/* "Vencido"/preaviso siguen mostrando daysUntil bruto (siempre tono
            rojo, sin contradicción posible); el caso general muestra
            actionableDaysUntil, la misma cifra que decide `ticket.tone`. */}
        <span className={cn("num shrink-0 text-[11px] font-semibold", TONE_TEXT_CLASSES[ticket.tone])}>
          {ticket.daysUntil < 0
            ? t("runway.overdue", { days: Math.abs(ticket.daysUntil) })
            : ticket.noticeWarning
              ? t("runway.noticeWarning", { days: ticket.daysUntil, noticeDays: ticket.cancellationNoticeDays })
              : t("runway.daysRemaining", { days: ticket.actionableDaysUntil })}
        </span>
      </a>
    </li>
  );
}

function TierSection({
  tier,
  locale,
  orgCurrency,
  t,
  expanded,
  onToggleExpanded,
}: {
  tier: RenewalAgendaTier;
  locale: string;
  orgCurrency: string;
  t: ReturnType<typeof useTranslations>;
  expanded: boolean;
  onToggleExpanded?: () => void;
}) {
  const totalFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: orgCurrency,
        maximumFractionDigits: 0,
      }),
    [locale, orgCurrency],
  );

  const emptyKey =
    tier.key === "critical" ? "runway.criticalEmpty" : tier.key === "upcoming" ? "runway.upcomingEmpty" : "runway.stableEmpty";

  // Crítico: siempre todo visible. Próximo: primeras N + "+N más". Estable:
  // colapsado por defecto (solo cabecera), expandible a la lista completa.
  const visibleTickets =
    tier.key === "critical"
      ? tier.tickets
      : tier.key === "upcoming"
        ? expanded
          ? tier.tickets
          : tier.tickets.slice(0, UPCOMING_VISIBLE)
        : expanded
          ? tier.tickets
          : [];
  const hiddenCount = tier.tickets.length - visibleTickets.length;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={cn("text-[13px] font-semibold", TIER_TONE_CLASS[tier.key])}>
          {t(`stackStatus.${tier.key}`)}
          <span className="num ml-1.5 font-normal text-ink-soft">
            {t("runway.contractsCount", { count: tier.tickets.length })}
          </span>
        </h3>
        {tier.tickets.length > 0 && (
          <span className="num text-[12px] text-ink-soft">{totalFormatter.format(tier.totalAnnualCostOrgCurrency)}</span>
        )}
      </div>

      {tier.tickets.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-ink-soft">{t(emptyKey)}</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-1.5">
            {visibleTickets.map((ticket) => (
              <TicketRow key={ticket.contractId} ticket={ticket} locale={locale} t={t} />
            ))}
          </ul>
          {tier.key === "upcoming" && hiddenCount > 0 && (
            <Button type="button" variant="link" size="sm" className="mt-1.5 px-0" onClick={onToggleExpanded}>
              {t("runway.moreCount", { count: hiddenCount })}
            </Button>
          )}
          {tier.key === "stable" && (
            <Button type="button" variant="link" size="sm" className="mt-1.5 px-0" onClick={onToggleExpanded}>
              {expanded ? t("runway.showLess") : t("runway.showMore")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function RenewalAgenda({
  tickets,
  locale,
  orgCurrency,
}: {
  tickets: RenewalTicket[];
  locale: string;
  orgCurrency: string;
}) {
  const t = useTranslations("Shell.dashboard");
  const [rangeDays, setRangeDays] = useState(120);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  const [stableExpanded, setStableExpanded] = useState(false);

  const tiers = useMemo(() => groupRenewalTicketsByTier(tickets, rangeDays), [tickets, rangeDays]);

  return (
    <div className="mt-6 rounded-[10px] border border-line bg-surface p-4 pb-5 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-disp text-base font-semibold text-ink">{t("runway.title")}</h2>
        <Tabs value={String(rangeDays)} onValueChange={(value) => setRangeDays(Number(value))}>
          <SegmentedControlList aria-label={t("runway.rangeLabel")}>
            {RANGE_OPTIONS.map((days) => (
              <SegmentedControlItem key={days} value={String(days)}>
                {t("runway.rangeOption", { days })}
              </SegmentedControlItem>
            ))}
          </SegmentedControlList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-5">
        {tiers.map((tier) => (
          <TierSection
            key={tier.key}
            tier={tier}
            locale={locale}
            orgCurrency={orgCurrency}
            t={t}
            expanded={tier.key === "upcoming" ? upcomingExpanded : tier.key === "stable" ? stableExpanded : true}
            onToggleExpanded={
              tier.key === "upcoming"
                ? () => setUpcomingExpanded((v) => !v)
                : tier.key === "stable"
                  ? () => setStableExpanded((v) => !v)
                  : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
