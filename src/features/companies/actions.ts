"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createCompanySchema, updateCompanySchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function createCompany(input: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = createCompanySchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_company", {
    p_name: parsed.data.name,
    p_tax_id: parsed.data.taxId,
    p_is_default: parsed.data.isDefault,
  });

  if (error || !data) {
    return { error: error?.message ?? "Could not create company" };
  }

  return { success: true, id: data as string };
}

export async function updateCompany(input: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = updateCompanySchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_company", {
    p_company_id: parsed.data.companyId,
    p_name: parsed.data.name,
    p_tax_id: parsed.data.taxId,
    p_is_default: parsed.data.isDefault,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true, id: parsed.data.companyId };
}

export async function deleteCompany(companyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_company", {
    p_company_id: companyId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
