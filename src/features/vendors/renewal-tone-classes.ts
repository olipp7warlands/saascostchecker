import type { RenewalTone } from "./renewal";

// Único sitio con las clases Tailwind por tono de urgencia — reusado por la
// pista de renovaciones del dashboard y el calendario de renovaciones, para
// que ambos coloreen exactamente igual.
export const TONE_CLASSES: Record<RenewalTone, string> = {
  red: "border-destructive bg-danger-soft",
  amber: "border-warning bg-warning-soft",
  neutral: "border-line bg-surface",
};

export const TONE_TEXT_CLASSES: Record<RenewalTone, string> = {
  red: "text-destructive",
  amber: "text-warning",
  neutral: "text-ink-soft",
};
