"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { parseApprovalToken } from "./approval-links";
import {
  createPurchaseRequestSchema,
  resolvePurchaseRequestSchema,
  resolvePurchaseRequestViaLinkSchema,
} from "./schemas";

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

export async function resolvePurchaseRequest(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = resolvePurchaseRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.rpc("resolve_purchase_request", {
    p_request_id: data.requestId,
    p_decision: data.decision,
    p_rejection_reason: data.rejectionReason,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/requests/${data.requestId}`);
  return { success: true };
}

// Sin sesión (aprobar/rechazar desde email/Teams) — el token autentica quién
// y qué; resolve_purchase_request_via_link() llama internamente a la misma
// advance_purchase_request_step() que usa la UI. Mensaje de error genérico
// para CUALQUIER motivo de fallo del token (no encontrado/expirado/usado/
// revocado) — nunca se distingue el motivo real.
export async function resolvePurchaseRequestViaLink(input: unknown): Promise<ActionResult> {
  const parsed = resolvePurchaseRequestViaLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const tokenParts = parseApprovalToken(parsed.data.token);
  if (!tokenParts) {
    return { error: "invalid_or_expired_token" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_purchase_request_via_link", {
    p_token_id: tokenParts.tokenId,
    p_secret: tokenParts.secret,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment,
  });

  if (error) {
    return { error: "invalid_or_expired_token" };
  }

  return { success: true };
}

export async function cancelPurchaseRequest(locale: string, requestId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_purchase_request", { p_request_id: requestId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/requests/${requestId}`);
  return { success: true };
}

export async function markPurchaseRequestPurchased(locale: string, requestId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_purchase_request_purchased", { p_request_id: requestId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/requests/${requestId}`);
  return { success: true };
}
