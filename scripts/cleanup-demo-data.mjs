#!/usr/bin/env node
// Deshace TODO lo sembrado por scripts/seed-demo-data.mjs, y solo eso —
// lee scripts/.demo-seed-manifest.json y borra por ID exacto, nunca por
// patrón de nombre (el patrón solo se usa al final como verificación
// cruzada de residuos, nunca para decidir qué borrar).
//
// Uso interactivo:      node --env-file=.env.local scripts/cleanup-demo-data.mjs
// Uso no interactivo:   node --env-file=.env.local scripts/cleanup-demo-data.mjs --confirm-org-slug=<slug>
// (mismo motivo que en seed-demo-data.mjs: con stdin sin TTY, readline puede
// auto-cerrarse por EOF antes de que el código llegue a preguntar.)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const MANIFEST_PATH = fileURLToPath(new URL("./.demo-seed-manifest.json", import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan variables de entorno. Ejecuta con:\n  node --env-file=.env.local scripts/cleanup-demo-data.mjs",
  );
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  console.error(`No existe ${MANIFEST_PATH} — no hay nada que limpiar (¿ya se corrió el cleanup, o nunca se sembró?).`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

const serviceRole = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const isTTY = Boolean(process.stdin.isTTY);
const rl = isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function confirm(question) {
  return rl.question(question);
}
function argFlag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function must(error, context) {
  if (error) {
    console.error(`✗ ${context}:`, error.message ?? error);
    throw error;
  }
}

async function deleteByIds(table, ids, extraLabel = "") {
  if (!ids || ids.length === 0) return 0;
  const { error, count } = await serviceRole.from(table).delete({ count: "exact" }).in("id", ids);
  must(error, `borrando ${table}${extraLabel}`);
  return count ?? 0;
}

async function main() {
  console.log("=== Cleanup de datos demo — StackX ===\n");
  console.log(`Org: ${manifest.orgSlug} (${manifest.orgId})`);
  console.log(`Sembrado el: ${manifest.createdAt}`);
  console.log(`Usuarios demo: ${manifest.userIds.length}, vendors: ${manifest.vendorIds.length}, contratos: ${manifest.contractIds.length}`);
  console.log(`Solicitudes: ${manifest.purchaseRequestIds.length}, spend_records: ${manifest.spendRecordIds.length}\n`);

  const slugQuestion = `Escribe el slug exacto de la org ("${manifest.orgSlug}") para confirmar el borrado: `;
  let typed;
  if (isTTY) {
    typed = await confirm(slugQuestion);
  } else {
    typed = argFlag("confirm-org-slug");
    if (typed === undefined) {
      console.error(`stdin no es un TTY interactivo — pasa --confirm-org-slug=${manifest.orgSlug} explícitamente.`);
      process.exit(1);
    }
    console.log(`${slugQuestion}(no interactivo) --confirm-org-slug=${typed}`);
  }
  if (typed.trim() !== manifest.orgSlug) {
    console.log("Slug no coincide. Abortando sin borrar nada.");
    if (rl) rl.close();
    process.exit(0);
  }
  if (rl) rl.close();

  const userPublicIds = manifest.userIds.map((u) => u.publicId);
  const userAuthIds = manifest.userIds.map((u) => u.authId);

  // 1-2. purchase_requests (cascada a steps/approval_actions/notifications) +
  // notifications sueltas por contrato/usuario (alertas de renovación que el
  // cron pudiera haber generado entre el seed y este cleanup).
  console.log("Borrando solicitudes de compra y notificaciones...");
  const prCount = await deleteByIds("purchase_requests", manifest.purchaseRequestIds);
  let notifCount = 0;
  if (manifest.contractIds.length > 0) {
    const { error, count } = await serviceRole
      .from("notifications")
      .delete({ count: "exact" })
      .in("contract_id", manifest.contractIds);
    must(error, "notifications por contract_id");
    notifCount += count ?? 0;
  }
  if (userPublicIds.length > 0) {
    const { error, count } = await serviceRole
      .from("notifications")
      .delete({ count: "exact" })
      .in("user_id", userPublicIds);
    must(error, "notifications por user_id");
    notifCount += count ?? 0;
  }
  console.log(`✓ ${prCount} solicitudes, ${notifCount} notificaciones sueltas.\n`);

  // 3-4. reconciliation_queue + spend_records + import_batches
  console.log("Borrando spend_records / reconciliation_queue / import_batches...");
  const rqCount = await deleteByIds("reconciliation_queue", manifest.reconciliationQueueIds);
  const spendCount = await deleteByIds("spend_records", manifest.spendRecordIds);
  const batchCount = await deleteByIds("import_batches", manifest.importBatchIds);
  console.log(`✓ ${rqCount} reconciliation_queue, ${spendCount} spend_records, ${batchCount} import_batches.\n`);

  // 5. budgets, vendor_tags, seat_assignments
  console.log("Borrando presupuestos, tags y licencias...");
  const budgetCount = await deleteByIds("budgets", manifest.budgetIds);
  const tagCount = await deleteByIds("vendor_tags", manifest.vendorTagIds);
  const seatCount = await deleteByIds("seat_assignments", manifest.seatAssignmentIds);
  console.log(`✓ ${budgetCount} budgets, ${tagCount} vendor_tags, ${seatCount} seat_assignments.\n`);

  // 6. contracts, vendors
  console.log("Borrando contratos y vendors...");
  const contractCount = await deleteByIds("contracts", manifest.contractIds);
  const vendorCount = await deleteByIds("vendors", manifest.vendorIds);
  console.log(`✓ ${contractCount} contratos, ${vendorCount} vendors.\n`);

  // 7. companies, departments
  console.log("Borrando empresas y departamentos...");
  const companyCount = await deleteByIds("companies", manifest.companyIds);
  const deptCount = await deleteByIds("departments", manifest.departmentIds);
  console.log(`✓ ${companyCount} companies, ${deptCount} departments.\n`);

  // 8. invitations de los usuarios demo (limpieza, ya usadas, no bloquean nada pero no deben quedar huérfanas)
  if (manifest.userIds.length > 0) {
    const emails = manifest.userIds.map((u) => u.email);
    await serviceRole.from("invitations").delete().in("email", emails);
  }

  // 9. public.users + auth.users
  console.log("Borrando usuarios demo (public.users + auth.users)...");
  await deleteByIds("users", userPublicIds);
  let authDeleted = 0;
  for (const authId of userAuthIds) {
    const { error } = await serviceRole.auth.admin.deleteUser(authId);
    if (error) {
      console.error(`  ⚠️  no se pudo borrar auth user ${authId}: ${error.message}`);
      continue;
    }
    authDeleted++;
  }
  console.log(`✓ ${authDeleted}/${userAuthIds.length} auth users borrados.\n`);

  // 10. Restaurar ajustes de notificaciones
  if (manifest.previousNotificationSettings) {
    const { error } = await serviceRole.from("org_notification_settings").upsert({
      org_id: manifest.orgId,
      email_alerts_enabled: manifest.previousNotificationSettings.email_alerts_enabled,
      teams_alerts_enabled: manifest.previousNotificationSettings.teams_alerts_enabled,
      teams_webhook_url: manifest.previousNotificationSettings.teams_webhook_url,
    });
    must(error, "restaurando org_notification_settings");
    console.log("✓ Ajustes de notificaciones restaurados a su valor previo.\n");
  }

  // 11. Verificación final — recuento por ID (debe dar 0) + patrón de nombre como red de seguridad
  console.log("=== Verificación final ===");
  const idChecks = [
    ["departments", manifest.departmentIds],
    ["companies", manifest.companyIds],
    ["vendors", manifest.vendorIds],
    ["contracts", manifest.contractIds],
    ["seat_assignments", manifest.seatAssignmentIds],
    ["import_batches", manifest.importBatchIds],
    ["spend_records", manifest.spendRecordIds],
    ["reconciliation_queue", manifest.reconciliationQueueIds],
    ["budgets", manifest.budgetIds],
    ["vendor_tags", manifest.vendorTagIds],
    ["purchase_requests", manifest.purchaseRequestIds],
    ["users", userPublicIds],
  ];
  let allZero = true;
  for (const [table, ids] of idChecks) {
    if (!ids || ids.length === 0) continue;
    const { count, error } = await serviceRole.from(table).select("*", { count: "exact", head: true }).in("id", ids);
    must(error, `verificando ${table}`);
    console.log(`  ${table}: ${count ?? 0} filas restantes de las sembradas`);
    if ((count ?? 0) > 0) allZero = false;
  }

  console.log("\n--- Red de seguridad por patrón de nombre (org completa) ---");
  const patternChecks = [
    ["departments", "name", "%(Demo)%"],
    ["companies", "name", "Demo Corp%"],
    ["vendors", "name", "%(Demo)%"],
    ["contracts", "name", "%(Demo)%"],
    ["purchase_requests", "vendor_name", "%Demo%"],
  ];
  let residueFound = false;
  for (const [table, col, pattern] of patternChecks) {
    const { data, error } = await serviceRole.from(table).select("id").eq("org_id", manifest.orgId).ilike(col, pattern);
    must(error, `red de seguridad ${table}`);
    if (data && data.length > 0) {
      residueFound = true;
      console.log(`  ⚠️  ${table}: ${data.length} filas quedan con patrón "${pattern}" no cubiertas por el manifest — revisar a mano: ${data.map((r) => r.id).join(", ")}`);
    }
  }
  if (!residueFound) console.log("  Sin residuos detectados por patrón de nombre.");

  if (allZero && !residueFound) {
    unlinkSync(MANIFEST_PATH);
    console.log(`\n✓ Todo limpio. Manifest borrado (${MANIFEST_PATH}).`);
  } else {
    console.log(`\n⚠️  Quedan residuos — el manifest NO se borra (${MANIFEST_PATH}), revisa los avisos de arriba antes de reintentar.`);
  }
}

main().catch((err) => {
  console.error("\n✗ Cleanup abortado por un error:", err);
  console.error(`El manifest en ${MANIFEST_PATH} se conserva — puedes reintentar el cleanup, es idempotente.`);
  process.exit(1);
});
