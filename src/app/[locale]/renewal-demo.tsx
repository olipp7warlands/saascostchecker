import { getTranslations } from "next-intl/server";
import { AppLogo } from "@/components/catalog/app-logo";
import { cn } from "@/lib/utils";

// Datos de demostración estáticos (no reales) — replican 1:1 los 5 tickets
// de landing.html, mismas posiciones/tonos/importes, para fidelidad visual
// exacta al mockup. No confundir con la pista de renovaciones real del
// dashboard (src/app/[locale]/(app)/dashboard/renewal-track.tsx), que sí
// calcula posiciones a partir de datos reales de la org.
type DemoTicket = {
  vendorName: string;
  website: string;
  annualCost: number;
  xPercent: number;
  lane: "top" | "bottom";
  tone: "hot" | "soon" | "ok";
  days: number;
  seats?: number;
};

const TICKETS: DemoTicket[] = [
  { vendorName: "Salesforce", website: "salesforce.com", annualCost: 38400, xPercent: 9, lane: "top", tone: "hot", days: 5 },
  { vendorName: "Figma", website: "figma.com", annualCost: 9120, xPercent: 27, lane: "bottom", tone: "soon", days: 26 },
  { vendorName: "HubSpot", website: "hubspot.com", annualCost: 21600, xPercent: 42, lane: "top", tone: "soon", days: 43 },
  { vendorName: "Notion", website: "notion.so", annualCost: 6240, xPercent: 63, lane: "bottom", tone: "ok", days: 70 },
  { vendorName: "ChatGPT Team", website: "openai.com", annualCost: 18000, xPercent: 78, lane: "top", tone: "ok", days: 86, seats: 60 },
];

// < 640px la franja no tiene sitio para 5 tickets sin cortarlos (el rojo,
// el protagonista, quedaba recortado por la izquierda) — por debajo de ese
// breakpoint se renderiza como lista vertical ordenada por días restantes,
// en vez de intentar encajar el mismo layout horizontal en menos ancho.
const TICKETS_BY_DAYS_ASC = [...TICKETS].sort((a, b) => a.days - b.days);

const TICKS = [
  { label: "7d", xPercent: 6 },
  { label: "30d", xPercent: 25 },
  { label: "60d", xPercent: 50 },
  { label: "90d", xPercent: 75 },
  { label: "120d", xPercent: 96 },
];

const TONE_CLASSES = {
  hot: "border-destructive bg-red-soft shadow-[0_6px_18px_-4px_rgba(196,69,47,.35)]",
  soon: "border-amber bg-amber-soft",
  ok: "border-line bg-surface",
} as const;

const TONE_TEXT_CLASSES = {
  hot: "text-destructive",
  soon: "text-[#B27A1E]",
  ok: "text-primary",
} as const;

function ticketStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations>>,
  ticket: DemoTicket,
) {
  if (ticket.tone === "hot") {
    return t("autoRenewsWarning", { days: ticket.days });
  }
  if (ticket.seats) {
    return t("daysRemainingWithSeats", { days: ticket.days, seats: ticket.seats });
  }
  return t("daysRemaining", { days: ticket.days });
}

function TicketBody({
  ticket,
  status,
  amount,
}: {
  ticket: DemoTicket;
  status: string;
  amount: string;
}) {
  return (
    <>
      <span className="flex items-center gap-1.75 text-[13px] font-semibold text-ink">
        <AppLogo domain={ticket.website} name={ticket.vendorName} size={18} />
        {ticket.vendorName}
      </span>
      <span className="num block text-[11.5px] text-ink-soft">{amount}</span>
      <div className={cn("num mt-0.5 text-[10.5px] font-semibold", TONE_TEXT_CLASSES[ticket.tone])}>{status}</div>
    </>
  );
}

export async function RenewalDemo({ locale }: { locale: string }) {
  const t = await getTranslations("Home.demo");
  const amountFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  const alertCompact = (
    <div className="mt-2 rounded-md border border-[#EFC4BA] bg-red-soft px-2.5 py-2 text-xs">
      <span className="num block font-semibold text-destructive">{t("alertLabel")}</span>
      <span className="mt-0.5 block text-ink">{t("alertMessage")}</span>
    </div>
  );

  return (
    <div
      id="producto"
      className="mx-auto mt-13 max-w-[900px] rounded-2xl border border-line bg-surface p-5.5 pb-7.5 text-left shadow-[0_20px_50px_-24px_rgba(27,39,51,.25)] sm:px-6"
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2.5">
        <b className="font-disp text-base font-semibold text-ink">{t("title")}</b>
        <span className="num text-[11.5px] text-ink-soft sm:hidden">{t("hintMobile")}</span>
        <span className="num hidden text-[11.5px] text-ink-soft sm:inline">{t("hint")}</span>
      </div>

      {/* < 640px: lista vertical, sin ticks de escala ni animación. */}
      <div className="flex flex-col gap-2.5 sm:hidden">
        {TICKETS_BY_DAYS_ASC.map((ticket) => (
          <div key={ticket.vendorName}>
            <div className={cn("w-full rounded-lg border px-3 py-2.5 shadow-sm", TONE_CLASSES[ticket.tone])}>
              <TicketBody
                ticket={ticket}
                status={ticketStatusLabel(t, ticket)}
                amount={t("perYear", { amount: amountFormatter.format(ticket.annualCost) })}
              />
            </div>
            {ticket.tone === "hot" && alertCompact}
          </div>
        ))}
      </div>

      {/* >= 640px: franja horizontal con drift, comportamiento sin cambios. */}
      <div className="hidden sm:block">
        <div className="overflow-x-auto pb-7">
          <div className="relative h-32 min-w-[620px] border-b border-line">
            {TICKS.map((tick) => (
              <div key={tick.label}>
                <div
                  className="absolute top-0 bottom-0 w-px bg-line"
                  style={{ left: `${tick.xPercent}%` }}
                />
                <span
                  className="num absolute -bottom-6 -translate-x-1/2 text-[10.5px] text-ink-soft"
                  style={{ left: `${tick.xPercent}%` }}
                >
                  {tick.label}
                </span>
              </div>
            ))}

            {TICKETS.map((ticket) => (
              <div
                key={ticket.vendorName}
                className={cn(
                  "animate-drift absolute min-w-[122px] -translate-x-1/2 rounded-lg border px-2.75 py-2 shadow-sm",
                  TONE_CLASSES[ticket.tone],
                )}
                style={{ left: `${ticket.xPercent}%`, top: ticket.lane === "top" ? 8 : 66 }}
              >
                <TicketBody
                  ticket={ticket}
                  status={ticketStatusLabel(t, ticket)}
                  amount={t("perYear", { amount: amountFormatter.format(ticket.annualCost) })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-[#EFC4BA] bg-red-soft px-3.5 py-2.75 text-sm">
          <span className="num font-semibold whitespace-nowrap text-destructive">{t("alertLabel")}</span>
          <span>{t("alertMessage")}</span>
        </div>
      </div>
    </div>
  );
}
