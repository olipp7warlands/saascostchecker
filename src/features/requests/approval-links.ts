import { timingSafeEqual } from "node:crypto";
import { hashToken } from "@/lib/token-hash";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ApprovalLinkTokenInfo = {
  requestId: string;
  stepOrder: number;
};

// Formato del token: "<id-de-fila>_<secreto-hex>" (mint_approval_link_token()
// en 0023_approval_engine.sql). El uuid no lleva "_", separar en el primero
// es inequívoco.
export function parseApprovalToken(token: string): { tokenId: string; secret: string } | null {
  const separatorIndex = token.indexOf("_");
  if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
    return null;
  }
  return { tokenId: token.slice(0, separatorIndex), secret: token.slice(separatorIndex + 1) };
}

// Verificación de solo lectura para la página de previsualización (GET, sin
// mutar nada). Usa service-role porque approval_link_tokens no tiene NINGÚN
// acceso de cliente vía RLS — igual que la ruta de cron.
//
// Mismo patrón que isAuthorized() en el cron de notificaciones: se trae el
// hash esperado y se compara en tiempo constante con crypto.timingSafeEqual,
// nunca con `===`/una comparación de igualdad de SQL expuesta al cliente.
//
// Devuelve null para CUALQUIER motivo de fallo (no encontrado, expirado,
// usado, revocado, secreto incorrecto) — la página nunca debe distinguir
// cuál de los casos es.
export async function verifyApprovalToken(token: string): Promise<ApprovalLinkTokenInfo | null> {
  const parsed = parseApprovalToken(token);
  if (!parsed) {
    return null;
  }

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("approval_link_tokens")
    .select("request_id, step_order, secret_hash, expires_at, used_at, revoked_at")
    .eq("id", parsed.tokenId)
    .maybeSingle();

  if (!row || row.used_at || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const expectedBuf = Buffer.from(row.secret_hash, "hex");
  const computedBuf = Buffer.from(hashToken(parsed.secret), "hex");

  if (expectedBuf.length !== computedBuf.length || !timingSafeEqual(expectedBuf, computedBuf)) {
    return null;
  }

  return { requestId: row.request_id, stepOrder: row.step_order };
}

export type ApprovalRequestSummary = {
  vendorName: string;
  estimatedAnnualCost: number;
  currency: string;
  requesterName: string | null;
  justification: string;
};

// Resumen de solo lectura para la página del link (sin sesión, service-role
// como el resto de este módulo).
export async function getApprovalRequestSummary(
  info: ApprovalLinkTokenInfo,
): Promise<ApprovalRequestSummary | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("purchase_requests")
    .select("vendor_name, estimated_annual_cost, currency, justification, users(full_name)")
    .eq("id", info.requestId)
    .maybeSingle();

  if (!data) {
    return null;
  }

  const requester = Array.isArray(data.users) ? data.users[0] : data.users;

  return {
    vendorName: data.vendor_name,
    estimatedAnnualCost: Number(data.estimated_annual_cost),
    currency: data.currency,
    requesterName: requester?.full_name ?? null,
    justification: data.justification,
  };
}
