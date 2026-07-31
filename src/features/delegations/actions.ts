"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { createApprovalDelegationSchema } from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function createApprovalDelegation(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = createApprovalDelegationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_approval_delegation", {
    p_delegator_user_id: parsed.data.delegatorUserId,
    p_delegate_user_id: parsed.data.delegateUserId,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/settings/delegations`);
  return { success: true };
}

export async function revokeApprovalDelegation(locale: string, delegationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_approval_delegation", { p_delegation_id: delegationId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${locale}/settings/delegations`);
  return { success: true };
}
