import { z } from "zod";
import { CATALOG_CATEGORIES } from "@/features/catalog/types";

const uuidOrNull = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

export const linkReconciliationSchema = z.object({
  queueId: z.string().uuid(),
  vendorId: uuidOrNull,
  catalogId: uuidOrNull,
});

export const createVendorFromReconciliationSchema = z.object({
  queueId: z.string().uuid(),
  vendorName: z.string().trim().min(1).max(200),
  website: z.string().trim().min(1).max(255),
  category: z.enum(CATALOG_CATEGORIES),
});

export const ignoreReconciliationSchema = z.object({
  queueId: z.string().uuid(),
});

export const bulkAcceptReconciliationSchema = z.object({
  queueIds: z.array(z.string().uuid()).min(1),
});

export type LinkReconciliationInput = z.infer<typeof linkReconciliationSchema>;
export type CreateVendorFromReconciliationInput = z.infer<typeof createVendorFromReconciliationSchema>;
export type BulkAcceptReconciliationInput = z.infer<typeof bulkAcceptReconciliationSchema>;
