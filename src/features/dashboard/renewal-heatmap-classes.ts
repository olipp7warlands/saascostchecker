import type { RenewalTone } from "@/features/vendors/renewal";
import type { RenewalHeatmapIntensity } from "./types";

// 3 escalones de intensidad = opacidad progresiva sobre el MISMO token que ya
// define el tono en TONE_CLASSES (renewal-tone-classes.ts) — nunca un color
// nuevo fuera del sistema de diseño. "low" reutiliza literalmente el mismo
// par borde/fondo que la agenda/calendario para quedar visualmente idéntico
// en el escalón más bajo. Las celdas no llevan texto encima (solo
// title/aria-label), así que el escalón "high" sólido no tiene problema de
// contraste.
export const HEATMAP_CELL_CLASSES: Record<RenewalTone, Record<RenewalHeatmapIntensity, string>> = {
  red: {
    low: "border-destructive bg-danger-soft",
    medium: "border-destructive bg-danger/55",
    high: "border-destructive bg-danger",
  },
  amber: {
    low: "border-warning bg-warning-soft",
    medium: "border-warning bg-warning/45",
    high: "border-warning bg-warning",
  },
  neutral: {
    low: "border-line bg-ink-soft/10",
    medium: "border-line bg-ink-soft/20",
    high: "border-line bg-ink-soft/30",
  },
};

// Celda sin contratos — neutra fija, fuera de la escala de intensidad.
export const HEATMAP_EMPTY_CELL_CLASSES = "border-line bg-surface";
