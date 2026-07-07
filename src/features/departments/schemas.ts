import { z } from "zod";

const managerUserIdSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  managerUserId: managerUserIdSchema,
});

export const updateDepartmentSchema = z.object({
  departmentId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  managerUserId: managerUserIdSchema,
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
