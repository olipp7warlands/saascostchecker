"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  bulkAcceptReconciliationSchema,
  createVendorFromReconciliationSchema,
  ignoreReconciliationSchema,
  linkReconciliationSchema,
} from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function linkReconciliation(input: unknown): Promise<ActionResult> {
  const parsed = linkReconciliationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_reconciliation", {
    p_queue_id: parsed.data.queueId,
    p_vendor_id: parsed.data.vendorId,
    p_catalog_id: parsed.data.catalogId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function createVendorFromReconciliation(input: unknown): Promise<ActionResult> {
  const parsed = createVendorFromReconciliationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_vendor_from_reconciliation", {
    p_queue_id: parsed.data.queueId,
    p_vendor_name: parsed.data.vendorName,
    p_website: parsed.data.website,
    p_category: parsed.data.category,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function ignoreReconciliation(input: unknown): Promise<ActionResult> {
  const parsed = ignoreReconciliationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("ignore_reconciliation", {
    p_queue_id: parsed.data.queueId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function bulkAcceptReconciliation(
  input: unknown,
): Promise<(ActionResult & { linked?: number; skipped?: number })> {
  const parsed = bulkAcceptReconciliationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_accept_reconciliation", {
    p_queue_ids: parsed.data.queueIds,
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as { linked: number; skipped: number } | null;
  return { success: true, linked: result?.linked ?? 0, skipped: result?.skipped ?? 0 };
}
