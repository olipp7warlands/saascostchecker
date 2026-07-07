import { z } from "zod";
import { roleSchema } from "@/features/auth/schemas";

export const updateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
});

const departmentIdSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.string().uuid().nullable(),
);

export const updateUserDepartmentSchema = z.object({
  userId: z.string().uuid(),
  departmentId: departmentIdSchema,
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserDepartmentInput = z.infer<typeof updateUserDepartmentSchema>;
