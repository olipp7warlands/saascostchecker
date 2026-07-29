"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createPurchaseRequestSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function createPurchaseRequest(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = createPurchaseRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: requestId, error } = await supabase.rpc("create_purchase_request", {
    p_catalog_id: data.catalogId,
    p_vendor_name: data.vendorName,
    p_estimated_annual_cost: data.estimatedAnnualCost,
    p_currency: data.currency,
    p_department_id: data.departmentId,
    p_justification: data.justification,
    p_alternatives_considered: data.alternativesConsidered,
  });

  if (error || !requestId) {
    return { error: error?.message ?? "Could not create purchase request" };
  }

  redirect(`/${locale}/requests/${requestId}`);
}
