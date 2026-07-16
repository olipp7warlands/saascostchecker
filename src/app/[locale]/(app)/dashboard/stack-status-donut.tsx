import { getTranslations } from "next-intl/server";
import type { StackStatusSummary } from "@/features/dashboard/types";

const RADIUS = 40;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Orden de severidad: crítico > próximo > estable > sin contrato activo.
// Colores de ESTADO (reservados, nunca reutilizados como "serie N") — misma
// paleta que ya usa el resto del dashboard (renewal-track.tsx, kpi-cards.tsx).
const SEGMENTS = [
  { key: "critical", color: "var(--danger)", dotClass: "bg-danger" },
  { key: "upcoming", color: "var(--warning)", dotClass: "bg-warning" },
  { key: "stable", color: "var(--success)", dotClass: "bg-success" },
  { key: "noContract", color: "var(--ink-soft)", dotClass: "bg-ink-soft" },
] as const;

export async function StackStatusDonut({
  summary,
  locale,
}: {
  summary: StackStatusSummary;
  locale: string;
}) {
  const t = await getTranslations("Shell.dashboard.stackStatus");

  let offset = 0;
  const arcs = SEGMENTS.map((segment) => {
    const value = summary[segment.key];
    const length = summary.total > 0 ? (value / summary.total) * CIRCUMFERENCE : 0;
    const arc = { ...segment, value, length, offset };
    offset += length;
    return arc;
  });

  return (
    <div className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-4 font-disp text-base font-semibold text-ink">{t("title")}</h2>
      {summary.total === 0 ? (
        <p className="text-sm text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative h-[168px] w-[168px] shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
              <g transform="rotate(-90 50 50)">
                {arcs
                  .filter((arc) => arc.value > 0)
                  .map((arc) => (
                    <circle
                      key={arc.key}
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke={arc.color}
                      strokeWidth={STROKE}
                      strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                      strokeDashoffset={-arc.offset}
                    >
                      <title>
                        {t(arc.key)}: {arc.value}
                      </title>
                    </circle>
                  ))}
              </g>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="num text-2xl font-semibold text-ink">{summary.total}</span>
              <span className="max-w-[70px] text-center text-[10.5px] leading-tight text-ink-soft">
                {t("vendorsTotal")}
              </span>
            </div>
          </div>

          <ul className="flex w-full flex-1 flex-col gap-1.5 text-sm">
            {SEGMENTS.filter((segment) => segment.key !== "noContract").map((segment) => (
              <li key={segment.key} className="flex items-center gap-2 px-1 py-0.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.dotClass}`} />
                <span className="text-ink">{t(segment.key)}</span>
                <span className="num ml-auto text-ink-soft">{summary[segment.key]}</span>
              </li>
            ))}
            <li>
              <a
                href={`/${locale}/vendors`}
                className="-mx-1 flex items-center gap-2 rounded-[7px] px-1 py-0.5 hover:bg-lime-soft"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink-soft" />
                <span className="text-ink underline">{t("noContract")}</span>
                <span className="num ml-auto text-ink-soft">{summary.noContract}</span>
              </a>
              {summary.noContract > 0 && (
                <p className="mt-0.5 pl-[18px] text-[11px] text-ink-soft">{t("noContractHint")}</p>
              )}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
