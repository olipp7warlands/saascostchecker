import { createHash } from "node:crypto";

// Compartido entre invitaciones (auth/actions.ts) y links de aprobación
// (requests/approval-links.ts) — mismo idioma en ambos: un secreto aleatorio
// nunca se persiste, solo su hash SHA-256.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
