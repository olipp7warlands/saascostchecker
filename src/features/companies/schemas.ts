import { z } from "zod";

const taxIdSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().trim().max(50).nullable(),
);

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: taxIdSchema,
  isDefault: z.boolean(),
});

export const updateCompanySchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  taxId: taxIdSchema,
  isDefault: z.boolean(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
