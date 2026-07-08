export type { ConfidenceTier } from "@/features/spend-import/types";
export { confidenceTier } from "@/features/spend-import/types";

export type ReconciliationStatus = "pending" | "linked" | "ignored";

export type ReconciliationQueueRow = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  rawDescription: string;
  suggestedCatalogId: string | null;
  suggestedName: string | null;
  suggestedWebsite: string | null;
  confidence: number | null;
  status: ReconciliationStatus;
};
