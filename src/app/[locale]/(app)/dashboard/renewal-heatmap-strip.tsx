"use client";

import type { useTranslations } from "next-intl";
import {
  HEATMAP_CELL_CLASSES,
  HEATMAP_EMPTY_CELL_CLASSES,
} from "@/features/dashboard/renewal-heatmap-classes";
import type { RenewalHeatmapIntensity, RenewalTicket } from "@/features/dashboard/types";
import type { RenewalTone } from "@/features/vendors/renewal";
import { cn } from "@/lib/utils";
import { HeatmapSrList } from "./renewal-heatmap-sr-list";

export type RenewalHeatmapStripCell = {
  key: string;
  active: boolean;
  onSelect: () => void;
  ariaLabel: string;
  tooltip: string;
  tone: RenewalTone;
  intensity: RenewalHeatmapIntensity | null;
};

// Mismo min/max que el grid de Día (renewal-heatmap.tsx) — celdas
// fraccionales que escalan con el ancho disponible en vez de tamaño fijo
// (bug real visto en captura del usuario), con un techo razonable para que
// no queden gigantes cuando N es pequeño y un suelo que activa el scroll
// horizontal ya contenido (`contain-layout`, ver abajo) cuando N es grande
// (Semana, hasta ~52 columnas) o el viewport es estrecho.
const CELL_MIN_PX = 11;
const CELL_MAX_PX = 32;

// Fila de N celdas-botón para los niveles semana/mes/año — mismo patrón que
// el componente semanal de v3 (commit 2b30026, ver docs/DECISIONS.md):
// celdas sin texto visible encima del color (solo title/aria-label, igual
// que el grid diario y por el mismo motivo — el escalón "high" sólido no
// tiene entonces problema de contraste), generalizado para servir a los 3
// niveles en vez de triplicar el componente.
function StripCellButton({ cell }: { cell: RenewalHeatmapStripCell }) {
  return (
    <button
      type="button"
      onClick={cell.onSelect}
      aria-pressed={cell.active}
      aria-label={cell.ariaLabel}
      title={cell.tooltip}
      className={cn(
        "aspect-square flex-1 rounded-[3px] border outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        cell.intensity === null
          ? HEATMAP_EMPTY_CELL_CLASSES
          : HEATMAP_CELL_CLASSES[cell.tone][cell.intensity],
        cell.active && "ring-2 ring-offset-1 ring-[var(--ring)]",
      )}
      style={{ minWidth: CELL_MIN_PX, maxWidth: CELL_MAX_PX }}
    />
  );
}

export function RenewalHeatmapStrip({
  cells,
  groupLabel,
  srTitle,
  srEmpty,
  srItems,
  locale,
  t,
}: {
  cells: RenewalHeatmapStripCell[];
  groupLabel: string;
  srTitle: string;
  srEmpty: string;
  srItems: { ticket: RenewalTicket; dateLabel: string }[];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      {/* contain-layout: mismo fix ya aplicado al grid diario y a otras
          tablas con min-width dentro de overflow-x-auto (ver
          docs/DECISIONS.md 2026-07-22) — evita que Chromium móvil ensanche
          el viewport de la página completa por el min-width por celda. */}
      <div role="group" aria-label={groupLabel} className="flex gap-1 overflow-x-auto pb-1 contain-layout">
        {cells.map((cell) => (
          <StripCellButton key={cell.key} cell={cell} />
        ))}
      </div>
      <HeatmapSrList title={srTitle} emptyText={srEmpty} items={srItems} locale={locale} t={t} />
    </div>
  );
}
