"use client";

import type { useTranslations } from "next-intl";
import type { RenewalTicket } from "@/features/dashboard/types";
import { buildContractPath } from "@/features/renewals/deep-link";

// Alternativa lineal para lectores de pantalla, compartida por el grid
// diario y el strip semana/mes/año: mismo criterio de 3 casos que las filas
// del panel (vencido / preaviso activo / caso general), un único sitio para
// no repetirlo en cada nivel de granularidad.
export function HeatmapSrList({
  title,
  emptyText,
  items,
  locale,
  t,
}: {
  title: string;
  emptyText: string;
  items: { ticket: RenewalTicket; dateLabel: string }[];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="sr-only">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <ul>
          {items.map(({ ticket, dateLabel }) => (
            <li key={ticket.contractId}>
              <a href={buildContractPath(locale, ticket.vendorId, ticket.contractId)}>
                {ticket.daysUntil < 0
                  ? t("heatmap.srOverdue", {
                      vendor: ticket.vendorName,
                      date: dateLabel,
                      days: Math.abs(ticket.daysUntil),
                    })
                  : ticket.noticeWarning
                    ? t("heatmap.srNoticeWarning", {
                        vendor: ticket.vendorName,
                        date: dateLabel,
                        days: ticket.daysUntil,
                        noticeDays: ticket.cancellationNoticeDays,
                      })
                    : t("heatmap.srDaysRemaining", {
                        vendor: ticket.vendorName,
                        date: dateLabel,
                        days: ticket.actionableDaysUntil,
                      })}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
