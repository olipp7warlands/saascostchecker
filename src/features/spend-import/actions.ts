"use server";

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { parseCsvText } from "./csv";
import { decodeCsvBuffer, parseCsvAmount, parseCsvDate } from "./parsing";
import { commitCsvImportSchema, previewCsvImportSchema } from "./schemas";
import type { CsvPreview } from "./types";

const PREVIEW_ROW_LIMIT = 6;

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

export async function previewCsvImport(input: unknown): Promise<CsvPreview | { error: string }> {
  const parsed = previewCsvImportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const { file } = parsed.data;
  const supabase = await createClient();

  const orgId = await currentOrgId(supabase);
  if (!orgId) {
    return { error: "Not authenticated" };
  }

  const buffer = await file.arrayBuffer();
  const { text, encoding } = decodeCsvBuffer(buffer);
  const { delimiter, rows } = parseCsvText(text);

  if (rows.length === 0) {
    return { error: "The file has no rows" };
  }

  // Suposición inicial (el usuario la confirma/corrige con el checkbox
  // "primera fila es cabecera" del formulario de mapeo); el valor real se
  // persiste en el commit (import_spend_records, ver migración 0009).
  const { data: batchId, error: batchError } = await supabase.rpc("create_import_batch", {
    p_original_filename: file.name,
    p_delimiter: delimiter,
    p_encoding: encoding,
    p_has_header: true,
  });

  if (batchError || !batchId) {
    return { error: batchError?.message ?? "Could not create import batch" };
  }

  const path = `${orgId}/${batchId}/${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from("spend-imports").upload(path, file, {
    contentType: "text/csv",
    upsert: true,
  });

  if (uploadError) {
    return { error: uploadError.message };
  }

  return {
    batchId,
    delimiter,
    encoding,
    rawRows: rows.slice(0, PREVIEW_ROW_LIMIT + 1),
  };
}

export async function commitCsvImport(input: unknown): Promise<
  ActionResult & { imported?: number; duplicates?: number; errors?: number }
> {
  const parsed = commitCsvImportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }
  const mapping = parsed.data;
  const supabase = await createClient();

  const orgId = await currentOrgId(supabase);
  if (!orgId) {
    return { error: "Not authenticated" };
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("original_filename")
    .eq("id", mapping.batchId)
    .single();

  if (batchError || !batch) {
    return { error: "Import batch not found" };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("default_currency")
    .eq("id", orgId)
    .single();
  const currency = org?.default_currency ?? "EUR";

  const path = `${orgId}/${mapping.batchId}/${sanitizeFileName(batch.original_filename)}`;
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("spend-imports")
    .download(path);

  if (downloadError || !fileBlob) {
    return { error: downloadError?.message ?? "Could not download the uploaded file" };
  }

  const buffer = await fileBlob.arrayBuffer();
  const { text } = decodeCsvBuffer(buffer);
  const { rows } = parseCsvText(text);
  const dataRows = mapping.hasHeader ? rows.slice(1) : rows;

  const records: { date: string; amount: number; currency: string; raw_description: string }[] = [];
  let errorCount = 0;

  for (const row of dataRows) {
    const rawDate = row[mapping.dateColumn];
    const rawAmount = row[mapping.amountColumn];
    const rawDescription = row[mapping.descriptionColumn];

    const date = parseCsvDate(rawDate ?? "", mapping.dateFormat);
    const amount = parseCsvAmount(rawAmount ?? "", mapping.decimalFormat);

    if (!date || amount === null || !rawDescription?.trim()) {
      errorCount += 1;
      continue;
    }

    records.push({
      date,
      amount: Math.abs(amount),
      currency,
      raw_description: rawDescription.trim(),
    });
  }

  const { data, error } = await supabase.rpc("import_spend_records", {
    p_batch_id: mapping.batchId,
    p_records: records,
    p_error_count: errorCount,
    p_has_header: mapping.hasHeader,
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as { imported: number; duplicates: number } | null;

  return {
    success: true,
    imported: result?.imported ?? 0,
    duplicates: result?.duplicates ?? 0,
    errors: errorCount,
  };
}
