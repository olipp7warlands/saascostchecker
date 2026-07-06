import { z } from "zod";

export const roleSchema = z.enum(["employee", "manager", "finance", "it_admin", "org_admin"]);

export const signUpOrganizationSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  orgSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug"),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3),
  locale: z.enum(["es", "en"]),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: roleSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(72),
});

export type SignUpOrganizationInput = z.infer<typeof signUpOrganizationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
