import { z } from "zod";

const APPROVER_ROLES = ["employee", "manager", "finance", "it_admin", "org_admin"] as const;

export const approvalStepSchema = z.discriminatedUnion("approverType", [
  z.object({ approverType: z.literal("auto") }),
  z.object({ approverType: z.literal("manager_of_requester") }),
  z.object({ approverType: z.literal("role"), approverRole: z.enum(APPROVER_ROLES) }),
  z.object({ approverType: z.literal("specific_user"), approverUserId: z.string().uuid() }),
]);

export type ApprovalStepInput = z.infer<typeof approvalStepSchema>;

export const approvalTierSchema = z.object({
  maxAmount: z.number().positive().nullable(),
  steps: z.array(approvalStepSchema).min(1, "each tier needs at least one step"),
});

export type ApprovalTierInput = z.infer<typeof approvalTierSchema>;

// Válida forma completa server-side también (fuente de verdad real es la
// RPC save_approval_rule_scope, esto es solo la primera capa) — tramos
// ascendentes, solo el último sin límite, 'auto' solo si es el único paso.
export const saveApprovalRuleScopeSchema = z
  .object({
    departmentId: z.string().uuid().nullable(),
    tiers: z.array(approvalTierSchema).min(1, "at least one tier is required"),
  })
  .superRefine((data, ctx) => {
    let prevMax = 0;
    data.tiers.forEach((tier, index) => {
      const isLast = index === data.tiers.length - 1;

      if (isLast) {
        if (tier.maxAmount !== null) {
          ctx.addIssue({
            code: "custom",
            message: "only the last tier may have an unbounded max_amount",
            path: ["tiers", index, "maxAmount"],
          });
        }
      } else if (tier.maxAmount === null || tier.maxAmount <= prevMax) {
        ctx.addIssue({
          code: "custom",
          message: "tier max_amount must be strictly increasing",
          path: ["tiers", index, "maxAmount"],
        });
      } else {
        prevMax = tier.maxAmount;
      }

      if (tier.steps.length > 1 && tier.steps.some((step) => step.approverType === "auto")) {
        ctx.addIssue({
          code: "custom",
          message: "approver_type=auto must be the only step in its tier",
          path: ["tiers", index, "steps"],
        });
      }
    });
  });

export type SaveApprovalRuleScopeInput = z.infer<typeof saveApprovalRuleScopeSchema>;
