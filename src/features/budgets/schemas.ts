import { z } from "zod";

const uuidOrNull = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

const currencySchema = z.string().trim().toUpperCase().length(3);

export const createBudgetSchema = z
  .object({
    companyId: uuidOrNull,
    departmentId: uuidOrNull,
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    amount: z.coerce.number().min(0),
    currency: currencySchema,
  })
  .refine((data) => data.companyId !== null || data.departmentId !== null, {
    message: "A budget must scope to a company, a department, or both",
    path: ["departmentId"],
  });

export const updateBudgetSchema = z.object({
  budgetId: z.string().uuid(),
  amount: z.coerce.number().min(0),
  currency: currencySchema,
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
