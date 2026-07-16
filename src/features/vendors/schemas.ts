import { z } from "zod";
import { CATALOG_CATEGORIES } from "@/features/catalog/types";

const uuidOrNull = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

const currencySchema = z.string().trim().toUpperCase().length(3);
const categorySchema = z.enum(CATALOG_CATEGORIES);
const billingCycleSchema = z.enum(["monthly", "annual", "one_time"]);
const vendorStatusSchema = z.enum(["active", "inactive", "trial"]);
const contractStatusSchema = z.enum(["active", "cancelled"]);

const contractFieldsSchema = {
  contractName: z.string().trim().min(1).max(200),
  costAmount: z.coerce.number().min(0),
  currency: currencySchema,
  billingCycle: billingCycleSchema,
  seatsPurchased: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(0).nullable(),
  ),
  startDate: z.string().trim().min(1),
  renewalDate: z.string().trim().min(1),
  autoRenews: z.boolean(),
  cancellationNoticeDays: z.coerce.number().int().min(0),
  departmentId: uuidOrNull,
  companyId: uuidOrNull,
  document: z
    .instanceof(File)
    .nullable()
    .optional()
    .transform((file) => (file && file.size > 0 ? file : null)),
};

export const createVendorWithContractSchema = z.object({
  catalogId: uuidOrNull,
  vendorName: z.string().trim().min(1).max(200),
  website: z.string().trim().min(1).max(255),
  category: categorySchema,
  isCustom: z.boolean(),
  ownerUserId: uuidOrNull,
  notes: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(2000).nullable(),
  ),
  ...contractFieldsSchema,
});

export const updateVendorSchema = z.object({
  vendorId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  website: z.string().trim().min(1).max(255),
  category: categorySchema,
  ownerUserId: uuidOrNull,
  status: vendorStatusSchema,
  notes: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(2000).nullable(),
  ),
});

export const createContractSchema = z.object({
  vendorId: z.string().uuid(),
  ...contractFieldsSchema,
});

export const updateContractSchema = z.object({
  contractId: z.string().uuid(),
  ...contractFieldsSchema,
  status: contractStatusSchema,
});

export const assignSeatSchema = z.object({
  contractId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const unassignSeatSchema = z.object({
  seatId: z.string().uuid(),
});

export const setSeatActiveSchema = z.object({
  seatId: z.string().uuid(),
  active: z.boolean(),
});

export type CreateVendorWithContractInput = z.infer<typeof createVendorWithContractSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type AssignSeatInput = z.infer<typeof assignSeatSchema>;
export type UnassignSeatInput = z.infer<typeof unassignSeatSchema>;
export type SetSeatActiveInput = z.infer<typeof setSeatActiveSchema>;
