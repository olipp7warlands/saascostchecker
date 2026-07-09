"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  assignSeatSchema,
  createContractSchema,
  createVendorWithContractSchema,
  setSeatActiveSchema,
  unassignSeatSchema,
  updateContractSchema,
  updateVendorSchema,
} from "./schemas";

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function currentOrgId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data: profile } = await supabase
    .from("users")
    .select("org_id")
    .eq("auth_id", user.id)
    .single();
  return profile?.org_id ?? null;
}

async function uploadContractDocument(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  const orgId = await currentOrgId(supabase);
  if (!orgId) {
    return { error: "Not authenticated" };
  }

  const path = `${orgId}/${contractId}/${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from("contracts").upload(path, file, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    return { error: error.message };
  }

  return { path };
}

export async function createVendorWithContract(
  locale: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = createVendorWithContractSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: vendorId, error: vendorError } = await supabase.rpc("create_vendor", {
    p_catalog_id: data.catalogId,
    p_name: data.vendorName,
    p_website: data.website,
    p_category: data.category,
    p_owner_user_id: data.ownerUserId,
    p_is_custom: data.isCustom,
    p_notes: data.notes,
  });

  if (vendorError || !vendorId) {
    return { error: vendorError?.message ?? "Could not create vendor" };
  }

  const { data: contractId, error: contractError } = await supabase.rpc("create_contract", {
    p_vendor_id: vendorId,
    p_name: data.contractName,
    p_cost_amount: data.costAmount,
    p_currency: data.currency,
    p_billing_cycle: data.billingCycle,
    p_seats_purchased: data.seatsPurchased,
    p_start_date: data.startDate,
    p_renewal_date: data.renewalDate,
    p_auto_renews: data.autoRenews,
    p_cancellation_notice_days: data.cancellationNoticeDays,
    p_document_url: null,
  });

  if (contractError || !contractId) {
    return { error: contractError?.message ?? "Could not create contract" };
  }

  if (data.document) {
    const uploaded = await uploadContractDocument(supabase, contractId, data.document);
    if ("error" in uploaded) {
      return { error: uploaded.error };
    }

    const { error: updateError } = await supabase.rpc("update_contract", {
      p_contract_id: contractId,
      p_name: data.contractName,
      p_cost_amount: data.costAmount,
      p_currency: data.currency,
      p_billing_cycle: data.billingCycle,
      p_seats_purchased: data.seatsPurchased,
      p_start_date: data.startDate,
      p_renewal_date: data.renewalDate,
      p_auto_renews: data.autoRenews,
      p_cancellation_notice_days: data.cancellationNoticeDays,
      p_document_url: uploaded.path,
      p_status: "active",
    });

    if (updateError) {
      return { error: updateError.message };
    }
  }

  redirect(`/${locale}/vendors/${vendorId}`);
}

export async function updateVendor(input: unknown): Promise<ActionResult> {
  const parsed = updateVendorSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_vendor", {
    p_vendor_id: parsed.data.vendorId,
    p_name: parsed.data.name,
    p_website: parsed.data.website,
    p_category: parsed.data.category,
    p_owner_user_id: parsed.data.ownerUserId,
    p_status: parsed.data.status,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteVendor(locale: string, vendorId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_vendor", { p_vendor_id: vendorId });

  if (error) {
    return { error: error.message };
  }

  redirect(`/${locale}/vendors`);
}

export async function createContract(input: unknown): Promise<ActionResult> {
  const parsed = createContractSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: contractId, error } = await supabase.rpc("create_contract", {
    p_vendor_id: data.vendorId,
    p_name: data.contractName,
    p_cost_amount: data.costAmount,
    p_currency: data.currency,
    p_billing_cycle: data.billingCycle,
    p_seats_purchased: data.seatsPurchased,
    p_start_date: data.startDate,
    p_renewal_date: data.renewalDate,
    p_auto_renews: data.autoRenews,
    p_cancellation_notice_days: data.cancellationNoticeDays,
    p_document_url: null,
  });

  if (error || !contractId) {
    return { error: error?.message ?? "Could not create contract" };
  }

  if (data.document) {
    const uploaded = await uploadContractDocument(supabase, contractId, data.document);
    if ("error" in uploaded) {
      return { error: uploaded.error };
    }

    const { error: updateError } = await supabase.rpc("update_contract", {
      p_contract_id: contractId,
      p_name: data.contractName,
      p_cost_amount: data.costAmount,
      p_currency: data.currency,
      p_billing_cycle: data.billingCycle,
      p_seats_purchased: data.seatsPurchased,
      p_start_date: data.startDate,
      p_renewal_date: data.renewalDate,
      p_auto_renews: data.autoRenews,
      p_cancellation_notice_days: data.cancellationNoticeDays,
      p_document_url: uploaded.path,
      p_status: "active",
    });

    if (updateError) {
      return { error: updateError.message };
    }
  }

  return { success: true };
}

export async function updateContract(input: unknown): Promise<ActionResult> {
  const parsed = updateContractSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  let documentPath: string | null = null;
  const { data: existing } = await supabase
    .from("contracts")
    .select("document_url")
    .eq("id", data.contractId)
    .single();
  documentPath = existing?.document_url ?? null;

  if (data.document) {
    const uploaded = await uploadContractDocument(supabase, data.contractId, data.document);
    if ("error" in uploaded) {
      return { error: uploaded.error };
    }
    documentPath = uploaded.path;
  }

  const { error } = await supabase.rpc("update_contract", {
    p_contract_id: data.contractId,
    p_name: data.contractName,
    p_cost_amount: data.costAmount,
    p_currency: data.currency,
    p_billing_cycle: data.billingCycle,
    p_seats_purchased: data.seatsPurchased,
    p_start_date: data.startDate,
    p_renewal_date: data.renewalDate,
    p_auto_renews: data.autoRenews,
    p_cancellation_notice_days: data.cancellationNoticeDays,
    p_document_url: documentPath,
    p_status: data.status,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteContract(contractId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_contract", { p_contract_id: contractId });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function assignSeat(
  input: unknown,
): Promise<ActionResult & { overCapacity?: boolean }> {
  const parsed = assignSeatSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_seat", {
    p_contract_id: parsed.data.contractId,
    p_user_id: parsed.data.userId,
  });

  const row = (Array.isArray(data) ? data[0] : null) as { over_capacity: boolean } | null;

  if (error || !row) {
    return { error: error?.message ?? "Could not assign seat" };
  }

  return { success: true, overCapacity: row.over_capacity };
}

export async function unassignSeat(input: unknown): Promise<ActionResult> {
  const parsed = unassignSeatSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("unassign_seat", { p_seat_id: parsed.data.seatId });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function setSeatActive(input: unknown): Promise<ActionResult> {
  const parsed = setSeatActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_seat_active", {
    p_seat_id: parsed.data.seatId,
    p_active: parsed.data.active,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function getContractDocumentUrl(
  contractId: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("document_url")
    .eq("id", contractId)
    .single();

  if (error || !contract?.document_url) {
    return { error: "Document not found" };
  }

  const { data, error: signError } = await supabase.storage
    .from("contracts")
    .createSignedUrl(contract.document_url, 60);

  if (signError || !data) {
    return { error: signError?.message ?? "Could not create signed URL" };
  }

  return { url: data.signedUrl };
}
