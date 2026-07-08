export const CSV_DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;
export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

export const CSV_DECIMAL_FORMATS = ["es", "en"] as const;
export type CsvDecimalFormat = (typeof CSV_DECIMAL_FORMATS)[number];

/**
 * Parsea una fecha de CSV bancario según el formato elegido por el usuario en
 * el mapeo (sin inferencia automática: DD/MM vs MM/DD es ambiguo para fechas
 * como "03/04/2026"). Devuelve ISO "YYYY-MM-DD" o null si no es una fecha
 * válida.
 */
export function parseCsvDate(raw: string, format: CsvDateFormat): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  const parts = s.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => p === "")) return null;

  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n))) return null;

  let day: number;
  let month: number;
  let year: number;
  if (format === "DD/MM/YYYY") {
    [day, month, year] = numbers;
  } else if (format === "MM/DD/YYYY") {
    [month, day, year] = numbers;
  } else {
    [year, month, day] = numbers;
  }

  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parsea un importe de CSV bancario. En formato "es" la coma es el separador
 * decimal y el punto (o espacio) son miles ("1.234,56"); en "en" es al
 * revés. Soporta negativos con "-" o entre paréntesis. Devuelve null si no es
 * un número válido.
 */
export function parseCsvAmount(raw: string, decimalFormat: CsvDecimalFormat): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  s = s.replace(/[€$\s]/g, "");
  if (s === "") return null;

  if (decimalFormat === "es") {
    if (/^\d{1,3}(\.\d{3})*,\d+$/.test(s)) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",") && s.includes(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
  } else {
    if (/^\d{1,3}(,\d{3})*\.\d+$/.test(s)) {
      s = s.replace(/,/g, "");
    } else if (s.includes(",") && s.includes(".")) {
      s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = s.replace(/,/g, "");
    }
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Decodifica el buffer crudo del CSV probando UTF-8 estricto primero y
 * cayendo a latin1 si falla — cubre los exports de bancos españoles que
 * siguen usando ISO-8859-1 sin necesidad de una dependencia de encoding.
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): { text: string; encoding: "utf-8" | "latin1" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: Buffer.from(buffer).toString("latin1"), encoding: "latin1" };
  }
}
