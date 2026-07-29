import { z } from "zod";

const uuidOrNull = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

const currencySchema = z.string().trim().toUpperCase().length(3);

export const createPurchaseRequestSchema = z.object({
  catalogId: uuidOrNull,
  vendorName: z.string().trim().min(1).max(200),
  estimatedAnnualCost: z.coerce.number().min(0),
  currency: currencySchema,
  departmentId: uuidOrNull,
  justification: z.string().trim().min(1).max(2000),
  alternativesConsidered: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.string().trim().max(2000).nullable(),
  ),
});
