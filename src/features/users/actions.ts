"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { updateUserDepartmentSchema, updateUserRoleSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function updateUserRole(input: unknown): Promise<ActionResult> {
  const parsed = updateUserRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_user_role", {
    p_user_id: parsed.data.userId,
    p_new_role: parsed.data.role,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function updateUserDepartment(input: unknown): Promise<ActionResult> {
  const parsed = updateUserDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_user_department", {
    p_user_id: parsed.data.userId,
    p_department_id: parsed.data.departmentId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
