import Papa from "papaparse";

export type ParsedCsv = {
  delimiter: string;
  rows: string[][];
};

/**
 * Envoltorio fino sobre papaparse: delimitador auto-detectado (coma,
 * punto-y-coma, tab — el auto-detect de la librería resuelve el caso más
 * común de bancos españoles usando ";"), filas vacías ignoradas.
 */
export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, {
    delimiter: "",
    skipEmptyLines: true,
  });

  return {
    delimiter: result.meta.delimiter || ",",
    rows: result.data,
  };
}
