"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { saveApprovalRuleScopeSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function saveApprovalRuleScope(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = saveApprovalRuleScopeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const p_tiers = parsed.data.tiers.map((tier) => ({
    max_amount: tier.maxAmount,
    steps: tier.steps.map((step) => ({
      approver_type: step.approverType,
      approver_role: step.approverType === "role" ? step.approverRole : null,
      approver_user_id: step.approverType === "specific_user" ? step.approverUserId : null,
    })),
  }));

  const { error } = await supabase.rpc("save_approval_rule_scope", {
    p_department_id: parsed.data.departmentId,
    p_tiers,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/team/approval-rules`);
  return { success: true };
}

export async function restoreDefaultApprovalRules(locale: string, departmentId: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_default_approval_rules", { p_department_id: departmentId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/team/approval-rules`);
  return { success: true };
}
