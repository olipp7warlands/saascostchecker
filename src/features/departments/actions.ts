"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createDepartmentSchema, updateDepartmentSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function createDepartment(input: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = createDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_department", {
    p_name: parsed.data.name,
    p_manager_user_id: parsed.data.managerUserId,
  });

  if (error || !data) {
    return { error: error?.message ?? "Could not create department" };
  }

  return { success: true, id: data as string };
}

export async function updateDepartment(input: unknown): Promise<ActionResult> {
  const parsed = updateDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_department", {
    p_department_id: parsed.data.departmentId,
    p_name: parsed.data.name,
    p_manager_user_id: parsed.data.managerUserId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteDepartment(departmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_department", {
    p_department_id: departmentId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
