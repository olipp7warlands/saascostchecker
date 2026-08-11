#!/usr/bin/env node
// Siembra un dataset demo denso y verosímil DENTRO DE LA ORG REAL de
// oliver.perez@sirtana.net (no una org efímera de prueba) para poder probar
// dashboard/calendario/presupuestos/licencias/procurement con volumen real.
//
// Uso interactivo (humano en su propia terminal):
//   node --env-file=.env.local scripts/seed-demo-data.mjs
//   (pide el slug de la org y si desactivar email/Teams, por teclado)
//
// Uso no interactivo (automatización / stdin sin TTY):
//   node --env-file=.env.local scripts/seed-demo-data.mjs \
//     --confirm-org-slug=<slug> --disable-notifications=yes|no
//   Node cierra el `readline` en cuanto stdin (no-TTY) llega a EOF, incluso
//   con preguntas pendientes — con stdin pipeado esto puede pasar antes de
//   que el código llegue a preguntar, así que sin TTY el script exige estos
//   dos flags explícitos en vez de intentar leer por stdin.
//
// Diseño (ver docs/DECISIONS.md y el plan de esta sesión):
// - Todo lo sembrado queda registrado en scripts/.demo-seed-manifest.json
//   (gitignored) a medida que se crea, tabla por tabla, incluidos los ids
//   de auth.users — es lo único que scripts/cleanup-demo-data.mjs usa para
//   borrar (nunca un patrón de nombre, eso es solo para que sea reconocible
//   a simple vista en la UI).
// - departments/companies/vendors/contracts/seat_assignments/budgets/
//   vendor_tags/spend_records/import_batches/reconciliation_queue se
//   escriben directos con service_role (confirmado sin invariantes ocultas
//   más allá de constraints que este script ya respeta a mano).
// - purchase_requests SIEMPRE vía las RPCs reales (create_purchase_request /
//   resolve_purchase_request / mark_purchase_request_purchased), llamadas
//   con la sesión de un usuario DEMO — nunca con service_role (auth.uid()
//   sería null) y nunca con la cuenta real de Oliver.

import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const OWNER_EMAIL = "oliver.perez@sirtana.net";
const MANIFEST_PATH = fileURLToPath(new URL("./.demo-seed-manifest.json", import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan variables de entorno. Ejecuta con:\n  node --env-file=.env.local scripts/seed-demo-data.mjs",
  );
  process.exit(1);
}

const serviceRole = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const isTTY = Boolean(process.stdin.isTTY);
const rl = isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function confirm(question) {
  const answer = await rl.question(question);
  return answer;
}
function argFlag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function requireNonInteractiveFlag(name, question) {
  const value = argFlag(name);
  if (value === undefined) {
    console.error(`stdin no es un TTY interactivo — pasa --${name}=... explícitamente.`);
    console.error(`  (la pregunta que se habría hecho por teclado era: "${question}")`);
    process.exit(1);
  }
  console.log(`${question} (no interactivo) --${name}=${value}`);
  return value;
}

function must(error, context) {
  if (error) {
    console.error(`✗ ${context}:`, error.message ?? error);
    throw error;
  }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr, i) {
  return arr[i % arr.length];
}
function pickRandom(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function isoMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(randInt(1, 27));
  return d.toISOString().slice(0, 10);
}
function randomPassword() {
  return `Demo${randomBytes(9).toString("base64url")}!1`;
}

// ---------------------------------------------------------------------------
// Manifest — única fuente de verdad para el cleanup. Se guarda en cada push.
// ---------------------------------------------------------------------------
const manifest = {
  ownerEmail: OWNER_EMAIL,
  orgId: null,
  orgSlug: null,
  createdAt: new Date().toISOString(),
  previousNotificationSettings: null,
  userIds: [], // {authId, publicId, email, role}
  departmentIds: [],
  companyIds: [],
  vendorIds: [],
  contractIds: [],
  seatAssignmentIds: [],
  importBatchIds: [],
  spendRecordIds: [],
  reconciliationQueueIds: [],
  budgetIds: [],
  vendorTagIds: [],
  purchaseRequestIds: [],
};
function saveManifest() {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Datos de referencia
// ---------------------------------------------------------------------------
const DEPARTMENT_NAMES = [
  "Marketing (Demo)",
  "Ingeniería (Demo)",
  "Ventas (Demo)",
  "Operaciones (Demo)",
  "Soporte (Demo)",
];

const COMPANY_NAMES = ["Demo Corp Norte", "Demo Corp Labs", "Demo Corp Retail"];

// {fullName, role, deptIndex} — 5 managers (uno por depto), 2 finance, 11 employees.
const DEMO_USERS = [
  { fullName: "Laura Gómez", role: "manager", dept: 0 },
  { fullName: "Marcos Ibáñez", role: "manager", dept: 1 },
  { fullName: "Elena Vidal", role: "manager", dept: 2 },
  { fullName: "Pablo Serrano", role: "manager", dept: 3 },
  { fullName: "Nuria Castillo", role: "manager", dept: 4 },
  { fullName: "Diego Molina", role: "finance", dept: null },
  { fullName: "Sara Ortega", role: "finance", dept: null },
  { fullName: "Iván Blanco", role: "employee", dept: 0 },
  { fullName: "Cristina Rey", role: "employee", dept: 0 },
  { fullName: "Álvaro Núñez", role: "employee", dept: 1 },
  { fullName: "Beatriz Lozano", role: "employee", dept: 1 },
  { fullName: "Rubén Cano", role: "employee", dept: 2 },
  { fullName: "Marta Iglesias", role: "employee", dept: 2 },
  { fullName: "Tomás Vega", role: "employee", dept: 3 },
  { fullName: "Lucía Peña", role: "employee", dept: 3 },
  { fullName: "Hugo Cortés", role: "employee", dept: 4 },
  { fullName: "Paula Reyes", role: "employee", dept: 4 },
  { fullName: "Adrián Soto", role: "employee", dept: 0 },
];

// Lista curada de nombres reales (SaaS clásico + IA) a buscar en saas_catalog.
// El script descarta los que no encuentre — nunca inventa un catalog_id.
const CATALOG_CANDIDATE_NAMES = [
  "Figma", "Slack", "Notion", "Asana", "Trello", "Airtable", "Zoom", "HubSpot",
  "Salesforce", "Mailchimp", "Intercom", "Zendesk", "Datadog", "PagerDuty",
  "AWS", "GitHub", "GitLab", "Jira", "Confluence", "Miro", "Loom", "Calendly",
  "DocuSign", "Evernote", "ClickUp", "Monday.com", "1Password", "LastPass",
  "Okta", "Auth0", "BambooHR", "Gusto", "ADP", "Ahrefs", "SEMrush", "Webflow",
  "Typeform", "SurveyMonkey", "Segment", "Amplitude", "Mixpanel", "Stripe",
  "QuickBooks", "Xero", "Airbase", "Snowflake", "Adobe Creative Cloud",
  "Canva", "Dropbox", "Box", "Google Workspace", "Microsoft 365", "Twilio",
  "Algolia", "Sentry", "New Relic", "CircleCI", "Vercel", "Netlify", "Heroku",
  "MongoDB Atlas", "Postman", "Adobe Photoshop", "Adobe Illustrator",
  "Affinity Designer", "Axure RP", "Aircall", "Apollo.io", "AppDynamics",
  "Amplitude", "Any.do", "Attio", "Backlog", "Airbyte",
  // IA
  "GitHub Copilot", "Midjourney", "ElevenLabs", "Perplexity", "Notion AI",
  "Jasper", "Copy.ai", "Runway", "Descript", "Otter.ai", "Fireflies.ai",
  "Synthesia", "Grammarly", "Claude", "ChatGPT", "OpenAI",
];

const VENDOR_TAG_POOL = ["marketing", "ia", "comunicación", "core", "piloto", "legal"];

const NOTES_TOOL_NAMES = new Set(["Notion", "Evernote"]);
const DESIGN_TOOL_NAMES = new Set(["Figma", "Canva", "Adobe Creative Cloud", "Adobe Photoshop"]);

// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Seed de datos demo — StackX ===\n");

  // 1. Resolver la org real
  const { data: ownerRows, error: ownerErr } = await serviceRole
    .from("users")
    .select("id, org_id, role, organizations(name, slug, default_currency)")
    .eq("email", OWNER_EMAIL);
  must(ownerErr, "buscando la org de " + OWNER_EMAIL);
  if (!ownerRows || ownerRows.length === 0) {
    console.error(`No se encontró ningún usuario con email ${OWNER_EMAIL}.`);
    process.exit(1);
  }
  if (ownerRows.length > 1) {
    console.error(`Hay ${ownerRows.length} orgs con ese email — desambigua a mano, abortando.`);
    process.exit(1);
  }
  const owner = ownerRows[0];
  const org = Array.isArray(owner.organizations) ? owner.organizations[0] : owner.organizations;
  manifest.orgId = owner.org_id;
  manifest.orgSlug = org.slug;
  saveManifest();

  console.log(`Org objetivo: "${org.name}" (slug: ${org.slug}, moneda default: ${org.default_currency})`);
  console.log(`Dueño real: ${OWNER_EMAIL} (rol: ${owner.role})\n`);
  console.log("⚠️  Este script escribe datos DEMO reales dentro de esta org de producción.");
  console.log("    Todo queda registrado en el manifest para poder deshacerlo con");
  console.log("    scripts/cleanup-demo-data.mjs, pero confírmalo antes de continuar.\n");

  const slugQuestion = `Escribe el slug exacto de la org ("${org.slug}") para confirmar: `;
  const typed = isTTY ? await confirm(slugQuestion) : requireNonInteractiveFlag("confirm-org-slug", slugQuestion);
  if (typed.trim() !== org.slug) {
    console.log("Slug no coincide. Abortando sin escribir nada.");
    if (rl) rl.close();
    process.exit(0);
  }

  const notifQuestion = "¿Desactivar alertas email/Teams de la org antes de sembrar? (recomendado) [S/n]:";
  let disable;
  if (isTTY) {
    const disableAnswer = await confirm(`${notifQuestion} `);
    disable = disableAnswer.trim().toLowerCase() !== "n";
    rl.close();
  } else {
    const flag = requireNonInteractiveFlag("disable-notifications", notifQuestion).trim().toLowerCase();
    if (flag !== "yes" && flag !== "no") {
      console.error('--disable-notifications debe ser "yes" o "no".');
      process.exit(1);
    }
    disable = flag === "yes";
  }

  // 2. Snapshot de conteos previos (para el resumen final)
  const countTables = [
    "departments", "companies", "vendors", "contracts", "seat_assignments",
    "spend_records", "budgets", "vendor_tags", "purchase_requests",
  ];
  const before = {};
  for (const t of countTables) {
    const { count } = await serviceRole.from(t).select("*", { count: "exact", head: true }).eq("org_id", manifest.orgId);
    before[t] = count ?? 0;
  }

  // 3. Seguridad de notificaciones
  const { data: existingSettings } = await serviceRole
    .from("org_notification_settings")
    .select("email_alerts_enabled, teams_alerts_enabled, teams_webhook_url")
    .eq("org_id", manifest.orgId)
    .maybeSingle();
  manifest.previousNotificationSettings = existingSettings ?? {
    email_alerts_enabled: true,
    teams_alerts_enabled: false,
    teams_webhook_url: null,
  };
  saveManifest();
  if (disable) {
    const { error } = await serviceRole.from("org_notification_settings").upsert({
      org_id: manifest.orgId,
      email_alerts_enabled: false,
      teams_alerts_enabled: false,
      teams_webhook_url: existingSettings?.teams_webhook_url ?? null,
    });
    must(error, "desactivando notificaciones");
    console.log("✓ Alertas email/Teams desactivadas para la org (se restauran con el cleanup).\n");
  } else {
    console.log("⚠️  Alertas dejadas como estaban — las solicitudes de compra demo pueden disparar emails reales en <15 min.\n");
  }

  // 4. Usuarios demo
  console.log(`Creando ${DEMO_USERS.length} usuarios demo...`);
  const passwordByEmail = new Map();
  const demoUsersByRole = { manager: [], finance: [], employee: [] };
  for (const spec of DEMO_USERS) {
    const slug = spec.fullName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, ".");
    const email = `demo.${slug}.${randomUUID().slice(0, 6)}@stackx-seed.invalid`;
    const password = randomPassword();
    const tokenHash = randomUUID();

    const { error: invErr } = await serviceRole.from("invitations").insert({
      org_id: manifest.orgId,
      email,
      role: spec.role,
      token_hash: tokenHash,
      invited_by: owner.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    must(invErr, `invitación para ${email}`);

    const { data: authUser, error: createErr } = await serviceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `[Demo] ${spec.fullName}`, invitation_token_hash: tokenHash },
    });
    must(createErr, `creando auth user ${email}`);

    const { data: publicUser, error: pubErr } = await serviceRole
      .from("users")
      .select("id")
      .eq("auth_id", authUser.user.id)
      .single();
    must(pubErr, `leyendo public.users tras crear ${email}`);

    passwordByEmail.set(email, password);
    const record = { authId: authUser.user.id, publicId: publicUser.id, email, role: spec.role, fullName: spec.fullName, dept: spec.dept };
    manifest.userIds.push({ authId: authUser.user.id, publicId: publicUser.id, email, role: spec.role });
    saveManifest();
    demoUsersByRole[spec.role].push(record);
  }
  console.log(`✓ ${manifest.userIds.length} usuarios demo creados.\n`);

  // 5. Departamentos (manager = el manager demo del mismo índice)
  console.log("Creando departamentos demo...");
  const departments = [];
  for (let i = 0; i < DEPARTMENT_NAMES.length; i++) {
    const manager = demoUsersByRole.manager[i];
    const { data, error } = await serviceRole
      .from("departments")
      .insert({ org_id: manifest.orgId, name: DEPARTMENT_NAMES[i], manager_user_id: manager?.publicId ?? null })
      .select("id")
      .single();
    must(error, `departamento ${DEPARTMENT_NAMES[i]}`);
    departments.push({ id: data.id, name: DEPARTMENT_NAMES[i], managerRecord: manager });
    manifest.departmentIds.push(data.id);
    saveManifest();
  }
  console.log(`✓ ${departments.length} departamentos creados.\n`);

  // 6. Empresas (nunca is_default)
  console.log("Creando empresas demo...");
  const companies = [];
  for (const name of COMPANY_NAMES) {
    const { data, error } = await serviceRole
      .from("companies")
      .insert({ org_id: manifest.orgId, name, is_default: false })
      .select("id")
      .single();
    must(error, `empresa ${name}`);
    companies.push({ id: data.id, name });
    manifest.companyIds.push(data.id);
    saveManifest();
  }
  console.log(`✓ ${companies.length} empresas creadas.\n`);

  // 7. Catálogo → vendors + contratos
  console.log("Buscando candidatos en saas_catalog...");
  const { data: catalogRows, error: catalogErr } = await serviceRole
    .from("saas_catalog")
    .select("id, name, category, website")
    .limit(2000);
  must(catalogErr, "leyendo saas_catalog");
  const catalogByLowerName = new Map(catalogRows.map((r) => [r.name.toLowerCase(), r]));

  const matchedCatalog = [];
  const seenCatalogIds = new Set();
  for (const candidate of CATALOG_CANDIDATE_NAMES) {
    const hit = catalogByLowerName.get(candidate.toLowerCase());
    if (hit && !seenCatalogIds.has(hit.id)) {
      matchedCatalog.push(hit);
      seenCatalogIds.add(hit.id);
    }
  }
  const chosenCatalog = matchedCatalog.slice(0, 50);
  console.log(`✓ ${chosenCatalog.length}/${CATALOG_CANDIDATE_NAMES.length} candidatos encontrados en el catálogo (usando los primeros 50).\n`);

  const allDemoUsers = [...demoUsersByRole.manager, ...demoUsersByRole.finance, ...demoUsersByRole.employee];

  console.log(`Creando ${chosenCatalog.length} vendors + contratos...`);
  const vendors = []; // {id, name, catalogName, category, catalogId}
  for (let i = 0; i < chosenCatalog.length; i++) {
    const cat = chosenCatalog[i];
    const owner_user_id = i < 3 ? null : pickRandom(allDemoUsers).publicId;
    const status = i === 12 || i === 33 ? "trial" : "active";

    const { data: vendorRow, error: vErr } = await serviceRole
      .from("vendors")
      .insert({
        org_id: manifest.orgId,
        catalog_id: cat.id,
        name: `${cat.name} (Demo)`,
        website: cat.website,
        category: cat.category,
        status,
        owner_user_id,
        is_custom: false,
      })
      .select("id")
      .single();
    must(vErr, `vendor ${cat.name}`);
    manifest.vendorIds.push(vendorRow.id);
    saveManifest();

    const dept = pick(departments, i);
    const company = i % 4 === 0 ? null : pick(companies, i);
    const currency = i % 15 === 0 ? (org.default_currency === "USD" ? "EUR" : "USD") : org.default_currency;
    const billing_cycle = i % 6 === 5 ? "one_time" : i % 3 === 0 ? "monthly" : "annual";
    const seats_purchased = i % 5 < 3 ? randInt(5, 50) : null;
    const cost_amount = billing_cycle === "one_time" ? randInt(500, 5000) : randInt(20, 400) * (billing_cycle === "annual" ? 12 : 1);

    const { data: contractRow, error: cErr } = await serviceRole
      .from("contracts")
      .insert({
        org_id: manifest.orgId,
        vendor_id: vendorRow.id,
        name: `${cat.name} (Demo)`,
        cost_amount,
        currency,
        billing_cycle,
        seats_purchased,
        start_date: isoDateOffset(-randInt(30, 700)),
        renewal_date: renewalDateForIndex(i),
        auto_renews: i % 3 !== 0,
        cancellation_notice_days: pick([15, 30, 45, 60, 90], i),
        department_id: dept.id,
        company_id: company?.id ?? null,
      })
      .select("id")
      .single();
    must(cErr, `contrato ${cat.name}`);
    manifest.contractIds.push(contractRow.id);
    saveManifest();

    vendors.push({
      id: vendorRow.id,
      catalogId: cat.id,
      name: cat.name,
      category: cat.category,
      contractId: contractRow.id,
      department: dept,
      companyId: company?.id ?? null,
      currency,
      costAmount: cost_amount,
      billingCycle: billing_cycle,
      seatsPurchased: seats_purchased,
    });
  }
  console.log(`✓ ${vendors.length} vendors + contratos creados.\n`);

  function renewalDateForIndex(i) {
    const bucket = i % 4;
    if (bucket === 0) return isoDateOffset(randInt(1, 6));
    if (bucket === 1) return isoDateOffset(randInt(8, 29));
    if (bucket === 2) return isoDateOffset(randInt(31, 89));
    return isoDateOffset(randInt(91, 720));
  }

  // 8. Licencias (seat_assignments) — solo para vendors con seats_purchased
  console.log("Asignando licencias...");
  let seatCount = 0;
  for (const v of vendors) {
    if (!v.seatsPurchased) continue;
    const overCapacity = v.seatsPurchased <= 8 && Math.random() < 0.15;
    const seatsToAssign = overCapacity ? v.seatsPurchased + randInt(1, 3) : randInt(Math.floor(v.seatsPurchased * 0.3), Math.max(1, v.seatsPurchased - 1));
    const assignees = shuffle([...allDemoUsers]).slice(0, Math.min(seatsToAssign, allDemoUsers.length));
    for (const user of assignees) {
      const active = Math.random() < 0.75;
      const { data, error } = await serviceRole
        .from("seat_assignments")
        .insert({
          org_id: manifest.orgId,
          contract_id: v.contractId,
          user_id: user.publicId,
          source: "manual",
          last_seen_active_at: active ? new Date(Date.now() - randInt(0, 20) * 86400000).toISOString() : null,
        })
        .select("id")
        .single();
      if (error) continue; // p.ej. unique (contract,user) por colisión de shuffle; se ignora, no crítico
      manifest.seatAssignmentIds.push(data.id);
      saveManifest();
      seatCount++;
    }
  }
  console.log(`✓ ${seatCount} asientos asignados.\n`);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 9. Import de gasto — 10 vendors × 12 meses
  console.log("Sembrando importación de gasto (spend_records)...");
  const { data: batch, error: batchErr } = await serviceRole
    .from("import_batches")
    .insert({
      org_id: manifest.orgId,
      uploaded_by: demoUsersByRole.finance[0]?.publicId ?? owner.id,
      original_filename: "demo-bank-export.csv",
      delimiter: ",",
      encoding: "utf-8",
      has_header: true,
      status: "completed",
      row_count: 0,
      imported_count: 0,
      duplicate_count: 0,
      error_count: 0,
    })
    .select("id")
    .single();
  must(batchErr, "import_batches");
  manifest.importBatchIds.push(batch.id);
  saveManifest();

  const spendVendors = vendors.filter((_, i) => i % 5 === 0).slice(0, 10);
  let spendCount = 0;
  let reconciledCount = 0;
  const spendByScope = new Map(); // `${department_id}|${company_id}` -> total en moneda default

  for (const v of spendVendors) {
    const monthlyBase = v.billingCycle === "annual" ? v.costAmount / 12 : v.costAmount;
    for (let m = 0; m < 12; m++) {
      const noisy = Math.round(monthlyBase * (0.95 + Math.random() * 0.1) * 100) / 100;
      const unreconciled = m % 6 === 0;
      const { data: spendRow, error: sErr } = await serviceRole
        .from("spend_records")
        .insert({
          org_id: manifest.orgId,
          vendor_id: unreconciled ? null : v.id,
          amount: noisy,
          currency: v.currency,
          date: isoMonthsAgo(11 - m),
          source: "card_csv",
          raw_description: `[DEMO] ${v.name.toUpperCase()} SUBSCRIPTION`,
          import_batch_id: batch.id,
          dedup_hash: randomUUID(),
        })
        .select("id")
        .single();
      must(sErr, `spend_record ${v.name} mes ${m}`);
      manifest.spendRecordIds.push(spendRow.id);
      saveManifest();
      spendCount++;

      if (unreconciled) {
        const { data: rq, error: rqErr } = await serviceRole
          .from("reconciliation_queue")
          .insert({
            org_id: manifest.orgId,
            spend_record_id: spendRow.id,
            suggested_catalog_id: v.catalogId,
            confidence: 0.72,
            status: "pending",
          })
          .select("id")
          .single();
        must(rqErr, `reconciliation_queue pendiente ${v.name}`);
        manifest.reconciliationQueueIds.push(rq.id);
        saveManifest();
      } else {
        const { data: rq, error: rqErr } = await serviceRole
          .from("reconciliation_queue")
          .insert({
            org_id: manifest.orgId,
            spend_record_id: spendRow.id,
            suggested_catalog_id: v.catalogId,
            confidence: 0.97,
            status: "linked",
            resolved_vendor_id: v.id,
            resolved_by: demoUsersByRole.finance[0]?.publicId ?? null,
            resolved_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        must(rqErr, `reconciliation_queue linked ${v.name}`);
        manifest.reconciliationQueueIds.push(rq.id);
        saveManifest();
        reconciledCount++;

        if (v.currency === org.default_currency) {
          const key = `${v.department.id}|${v.companyId ?? "null"}`;
          spendByScope.set(key, (spendByScope.get(key) ?? 0) + noisy);
        }
      }
    }
  }
  console.log(`✓ ${spendCount} spend_records sembrados (${reconciledCount} conciliados, ${spendCount - reconciledCount} pendientes).\n`);

  // 10. Presupuestos — 2-3 bolsas depto×empresa, una cerca del límite
  console.log("Creando presupuestos demo...");
  const fiscalYear = new Date().getFullYear();
  const scopeEntries = [...spendByScope.entries()].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]);
  const budgetTargets = scopeEntries.slice(0, 3);
  if (budgetTargets.length === 0) {
    console.log("⚠️  No hubo gasto en la moneda default para ninguna combinación depto×empresa — se omiten presupuestos.\n");
  } else {
    const multipliers = [1.08, 1.6, 2.2];
    for (let i = 0; i < budgetTargets.length; i++) {
      const [key, total] = budgetTargets[i];
      const [departmentId, companyIdRaw] = key.split("|");
      const companyId = companyIdRaw === "null" ? null : companyIdRaw;
      const amount = Math.round(total * multipliers[i]);
      const { data, error } = await serviceRole
        .from("budgets")
        .insert({
          org_id: manifest.orgId,
          department_id: departmentId,
          company_id: companyId,
          fiscal_year: fiscalYear,
          amount,
          currency: org.default_currency,
        })
        .select("id")
        .single();
      must(error, `budget ${key}`);
      manifest.budgetIds.push(data.id);
      saveManifest();
    }
    console.log(`✓ ${budgetTargets.length} presupuestos creados (el primero cerca del límite: ~${Math.round(1 / multipliers[0] * 100)}% consumido).\n`);
  }

  // 11. Tags con solapamiento deliberado
  console.log("Añadiendo tags...");
  let tagCount = 0;
  async function addTag(vendorId, tag) {
    const normalized = tag.toLowerCase().trim();
    const { data, error } = await serviceRole
      .from("vendor_tags")
      .insert({ org_id: manifest.orgId, vendor_id: vendorId, tag: normalized })
      .select("id")
      .single();
    if (error) return; // colisión de unique (vendor,tag), ignorable
    manifest.vendorTagIds.push(data.id);
    saveManifest();
    tagCount++;
  }
  const designVendors = vendors.filter((v) => DESIGN_TOOL_NAMES.has(v.name)).slice(0, 2);
  const notesVendors = vendors.filter((v) => NOTES_TOOL_NAMES.has(v.name)).slice(0, 2);
  for (const v of designVendors) await addTag(v.id, "diseño");
  for (const v of notesVendors) await addTag(v.id, "notas");
  for (const v of shuffle([...vendors]).slice(0, 15)) await addTag(v.id, pickRandom(VENDOR_TAG_POOL));
  console.log(`✓ ${tagCount} tags añadidos (incl. solapamiento en "diseño"/"notas" si había candidatos).\n`);

  // 12. Solicitudes de compra — 4 estados, siempre vía RPC real, como usuarios demo
  console.log("Creando solicitudes de compra demo (vía RPC real)...");
  const requester1 = demoUsersByRole.employee[0];
  const requester2 = demoUsersByRole.employee[1];
  const requester3 = demoUsersByRole.employee[2];
  const requester4 = demoUsersByRole.employee[3];

  async function sessionFor(email) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: passwordByEmail.get(email) });
    must(error, `login demo ${email}`);
    return client;
  }

  async function driveRequestToResolution(requesterEmail, requestArgs, finalDecision) {
    const requesterClient = await sessionFor(requesterEmail);
    const { data: requestId, error } = await requesterClient.rpc("create_purchase_request", requestArgs);
    must(error, `create_purchase_request (${requestArgs.p_vendor_name})`);
    manifest.purchaseRequestIds.push(requestId);
    saveManifest();

    if (finalDecision === "pending") return requestId;

    // Resuelve pasos activos en cadena, hasta 5 saltos de seguridad, usando
    // el aprobador que la propia RPC ya resolvió (nunca la cuenta real).
    for (let hop = 0; hop < 5; hop++) {
      const { data: steps, error: stepsErr } = await serviceRole
        .from("purchase_request_steps")
        .select("step_order, status, approver_role, resolved_approver_id")
        .eq("request_id", requestId)
        .eq("status", "pending");
      must(stepsErr, `leyendo pasos de ${requestId}`);
      if (!steps || steps.length === 0) break;
      const step = steps[0];
      // Pasos 'specific_user'/'manager_of_requester' traen resolved_approver_id
      // directo. Pasos 'role' (p.ej. finance) pueden dejarlo null — en ese
      // caso cualquier usuario demo con ese rol puede resolverlo.
      let approverUser = manifest.userIds.find((u) => u.publicId === step.resolved_approver_id);
      if (!approverUser && step.approver_role) {
        approverUser = manifest.userIds.find((u) => u.role === step.approver_role);
      }
      if (!approverUser) {
        console.log(`  ⚠️  Paso ${step.step_order} de ${requestId} resuelve fuera del pool demo — dejando la solicitud sin resolver ese paso (nunca se usa la cuenta real).`);
        break;
      }
      const approverClient = await sessionFor(approverUser.email);
      const decision = finalDecision === "rejected" ? "rejected" : "approved";
      const { error: resolveErr } = await approverClient.rpc("resolve_purchase_request", {
        p_request_id: requestId,
        p_decision: decision,
        p_rejection_reason: decision === "rejected" ? "Presupuesto departamental ya comprometido este trimestre (demo)." : null,
      });
      must(resolveErr, `resolve_purchase_request ${requestId}`);
      if (decision === "rejected") break;
    }

    if (finalDecision === "purchased") {
      const requesterAgain = await sessionFor(requesterEmail);
      const { error: purchErr } = await requesterAgain.rpc("mark_purchase_request_purchased", { p_request_id: requestId });
      must(purchErr, `mark_purchase_request_purchased ${requestId}`);
    }
    return requestId;
  }

  const overlapCatalogVendor = vendors[0];
  const requests = [
    {
      requester: requester1,
      args: {
        p_catalog_id: overlapCatalogVendor.catalogId,
        p_vendor_name: `${overlapCatalogVendor.name} (Demo)`,
        p_estimated_annual_cost: 900,
        p_currency: org.default_currency,
        p_department_id: departments[0].id,
        p_justification: "Solicitud demo — herramienta ya existente en el stack, para probar el aviso de solapamiento.",
        p_alternatives_considered: null,
      },
      decision: "pending",
    },
    {
      requester: requester2,
      args: {
        p_catalog_id: null,
        p_vendor_name: "Herramienta Demo Aprobada",
        p_estimated_annual_cost: 1200,
        p_currency: org.default_currency,
        p_department_id: departments[1].id,
        p_justification: "Solicitud demo aprobada, sin convertir todavía a vendor/contrato.",
        p_alternatives_considered: "Alternativa demo evaluada y descartada por coste.",
      },
      decision: "approved",
    },
    {
      requester: requester3,
      args: {
        p_catalog_id: null,
        p_vendor_name: "Herramienta Demo Rechazada",
        p_estimated_annual_cost: 3000,
        p_currency: org.default_currency,
        p_department_id: departments[2].id,
        p_justification: "Solicitud demo pensada para ser rechazada.",
        p_alternatives_considered: null,
      },
      decision: "rejected",
    },
    {
      requester: requester4,
      args: {
        p_catalog_id: null,
        p_vendor_name: "Herramienta Demo Comprada",
        p_estimated_annual_cost: 800,
        p_currency: org.default_currency,
        p_department_id: departments[3].id,
        p_justification: "Solicitud demo llevada hasta 'comprada'.",
        p_alternatives_considered: null,
      },
      decision: "purchased",
    },
  ];

  for (const r of requests) {
    if (!r.requester) continue;
    const requestId = await driveRequestToResolution(r.requester.email, r.args, r.decision);
    const { data: finalRow } = await serviceRole.from("purchase_requests").select("status").eq("id", requestId).single();
    const actual = finalRow?.status ?? "?";
    const flag = actual === r.decision || (r.decision === "purchased" && actual === "purchased") ? "" : "  ⚠️ distinto al objetivo (probablemente la matriz de aprobación real de la org difiere del seed default)";
    console.log(`  "${r.args.p_vendor_name}" → objetivo ${r.decision}, resultado real: ${actual}${flag}`);
  }
  console.log(`✓ ${manifest.purchaseRequestIds.length} solicitudes de compra creadas.\n`);

  // 13. Resumen final
  const after = {};
  for (const t of countTables) {
    const { count } = await serviceRole.from(t).select("*", { count: "exact", head: true }).eq("org_id", manifest.orgId);
    after[t] = count ?? 0;
  }

  console.log("=== Resumen (antes → después, org completa) ===");
  for (const t of countTables) console.log(`  ${t}: ${before[t]} → ${after[t]}`);
  console.log(`\nManifest guardado en: ${MANIFEST_PATH}`);
  console.log("Para deshacer todo: node --env-file=.env.local scripts/cleanup-demo-data.mjs\n");
  console.log("Qué verificar a mano en la app: dashboard (KPIs y pista de renovaciones),");
  console.log("calendario, /vendors (filtro por tag 'diseño'/'notas'), /team/budgets");
  console.log("(una bolsa cerca del límite), /requests (4 estados), /team/members (~18 usuarios *.invalid).");
}

main().catch((err) => {
  console.error("\n✗ Seed abortado por un error:", err);
  console.error(`El manifest en ${MANIFEST_PATH} refleja lo creado hasta el fallo — puedes correr el cleanup para deshacerlo.`);
  process.exit(1);
});
