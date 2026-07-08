export type ImportBatchStatus = "uploaded" | "processing" | "completed";

export type ImportBatch = {
  id: string;
  originalFilename: string;
  delimiter: string;
  encoding: "utf-8" | "latin1";
  hasHeader: boolean;
  status: ImportBatchStatus;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  createdAt: string;
};

// rawRows son las primeras filas TAL CUAL (sin asumir si la primera es
// cabecera) — el wizard cliente decide cómo mostrarlas según el checkbox
// "primera fila es cabecera", sin necesidad de un segundo viaje al servidor
// cuando el usuario lo cambia de opinión.
export type CsvPreview = {
  batchId: string;
  delimiter: string;
  encoding: "utf-8" | "latin1";
  rawRows: string[][];
};

export type ConfidenceTier = "high" | "medium" | "none";

export function confidenceTier(confidence: number | null): ConfidenceTier {
  if (confidence == null) return "none";
  if (confidence >= 0.65) return "high";
  if (confidence >= 0.4) return "medium";
  return "none";
}
