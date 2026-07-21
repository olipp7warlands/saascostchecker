"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createBudgetSchema, updateBudgetSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function createBudget(input: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = createBudgetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_budget", {
    p_company_id: parsed.data.companyId,
    p_department_id: parsed.data.departmentId,
    p_fiscal_year: parsed.data.fiscalYear,
    p_amount: parsed.data.amount,
    p_currency: parsed.data.currency,
  });

  if (error || !data) {
    return { error: error?.message ?? "Could not create budget" };
  }

  return { success: true, id: data as string };
}

export async function updateBudget(input: unknown): Promise<ActionResult> {
  const parsed = updateBudgetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_budget", {
    p_budget_id: parsed.data.budgetId,
    p_amount: parsed.data.amount,
    p_currency: parsed.data.currency,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteBudget(budgetId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_budget", { p_budget_id: budgetId });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
