import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Mismo guard que shell.spec.ts/requests.spec.ts: crea org/usuarios reales
// (signUp + RPCs), solo corre contra Supabase local.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

async function createOrgAdmin(label: string) {
  const client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const suffix = randomSuffix();
  const email = `${label}-admin-${suffix}@example.test`;
  const password = "Test1234!";

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: "Admin Aprobador",
        org_name: `${label} Org ${suffix}`,
        org_slug: `${label}-org-${suffix}`,
        default_currency: "EUR",
        locale: "es",
      },
    },
  });

  if (error || !data.user) {
    throw error ?? new Error("signUp did not return a user");
  }

  return { client, email, password };
}

async function inviteEmployee(adminClient: SupabaseClient, email: string): Promise<string> {
  return inviteUser(adminClient, email, "employee");
}

async function inviteUser(adminClient: SupabaseClient, email: string, role: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await adminClient.rpc("create_invitation", {
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });
  if (error) throw error;

  return rawToken;
}

// Acepta una invitación vía API (sin UI) — para actores secundarios de un
// escenario donde solo el flujo PRINCIPAL necesita pasar por la UI real.
async function acceptInvitationViaApi(rawToken: string, fullName: string, password: string) {
  const client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { data: preview, error: previewError } = await client.rpc("get_invitation_preview", {
    p_token_hash: tokenHash,
  });
  if (previewError || !preview?.[0]) throw previewError ?? new Error("invitation preview not found");
  const { error } = await client.auth.signUp({
    email: preview[0].email,
    password,
    options: { data: { full_name: fullName, invitation_token_hash: tokenHash } },
  });
  if (error) throw error;
  return client;
}

async function setUpDepartmentEngine(admin: SupabaseClient, managerPublicId: string) {
  const name = `Approval Engine Dept ${randomSuffix()}`;
  const { error } = await admin.rpc("create_department", {
    p_name: name,
    p_manager_user_id: managerPublicId,
  });
  if (error) throw error;
  return name;
}

test.describe("Ciclo de aprobación de solicitudes (bloque 3.1b)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("empleado solicita, org_admin aprueba, el empleado ve la notificación en la campanita", async ({
    browser,
  }) => {
    const admin = await createOrgAdmin("approve-flow");
    const employeeEmail = `approve-flow-employee-${randomSuffix()}@example.test`;
    const rawToken = await inviteEmployee(admin.client, employeeEmail);

    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      // 1. El empleado acepta la invitación y crea la solicitud.
      await employeePage.goto(`/es/invite/${rawToken}`);
      await employeePage.getByLabel("Tu nombre completo").fill("Empleado Solicitante");
      await employeePage.getByLabel("Elige una contraseña").fill("Test1234!");
      await employeePage.getByRole("button", { name: "Unirme" }).click();
      await employeePage.waitForURL(/\/es\/dashboard$/);

      await employeePage.goto("/es/requests/new");
      const combobox = employeePage.getByRole("combobox");
      await combobox.fill("figm");
      await employeePage.getByRole("option").filter({ hasText: "Figma" }).click();
      await employeePage.getByLabel("Coste anual estimado").fill("1200");
      await employeePage.getByLabel("Moneda").fill("EUR");
      await employeePage
        .getByLabel("Justificación")
        .fill("Necesitamos una herramienta de diseño compartida para el equipo.");
      await employeePage.getByRole("button", { name: "Enviar solicitud" }).click();
      await employeePage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });
      await expect(employeePage.getByText("Pendiente", { exact: true })).toBeVisible();

      // 2. El org_admin ve la solicitud en su lista (RLS ampliada, bloque
      // 3.1b) con el nombre del solicitante, y la aprueba.
      await adminPage.goto("/es/login");
      await adminPage.getByLabel("Email").fill(admin.email);
      await adminPage.getByLabel("Contraseña").fill(admin.password);
      await adminPage.getByRole("button", { name: "Entrar" }).click();
      await adminPage.waitForURL(/\/es\/dashboard$/);

      await adminPage.goto("/es/requests");
      const row = adminPage.getByRole("row", { name: /Figma/ });
      await expect(row).toBeVisible();
      await expect(row.getByText("Empleado Solicitante")).toBeVisible();
      await row.getByRole("link", { name: /Figma/ }).click();
      await adminPage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/);

      await adminPage.getByRole("button", { name: "Aprobar" }).click();
      await expect(adminPage.getByText("Aprobada", { exact: true })).toBeVisible();

      // 3. El empleado ve el resultado en su detalle y en la campanita.
      await employeePage.reload();
      await expect(employeePage.getByText("Aprobada", { exact: true })).toBeVisible();

      const bell = employeePage.getByRole("button", { name: "Notificaciones" });
      await bell.click();
      await expect(employeePage.getByText("Tu solicitud de Figma fue aprobada")).toBeVisible();
    } finally {
      await employeeContext.close();
      await adminContext.close();
    }
  });

  test("org_admin rechaza con motivo obligatorio; el solicitante ve el motivo", async ({ browser }) => {
    const admin = await createOrgAdmin("reject-flow");
    const employeeEmail = `reject-flow-employee-${randomSuffix()}@example.test`;
    const rawToken = await inviteEmployee(admin.client, employeeEmail);

    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      await employeePage.goto(`/es/invite/${rawToken}`);
      await employeePage.getByLabel("Tu nombre completo").fill("Empleado Rechazado");
      await employeePage.getByLabel("Elige una contraseña").fill("Test1234!");
      await employeePage.getByRole("button", { name: "Unirme" }).click();
      await employeePage.waitForURL(/\/es\/dashboard$/);

      await employeePage.goto("/es/requests/new");
      const combobox = employeePage.getByRole("combobox");
      await combobox.fill("notion");
      await employeePage.getByRole("option").filter({ hasText: "Notion" }).click();
      await employeePage.getByLabel("Coste anual estimado").fill("800");
      await employeePage.getByLabel("Moneda").fill("EUR");
      await employeePage.getByLabel("Justificación").fill("Documentación centralizada para el equipo.");
      await employeePage.getByRole("button", { name: "Enviar solicitud" }).click();
      await employeePage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });
      const requestUrl = employeePage.url();

      await adminPage.goto("/es/login");
      await adminPage.getByLabel("Email").fill(admin.email);
      await adminPage.getByLabel("Contraseña").fill(admin.password);
      await adminPage.getByRole("button", { name: "Entrar" }).click();
      await adminPage.waitForURL(/\/es\/dashboard$/);

      await adminPage.goto(requestUrl);
      await adminPage.getByRole("button", { name: "Rechazar" }).click();
      await adminPage.getByLabel("Motivo del rechazo").fill("Ya tenemos Confluence para esto.");
      await adminPage.getByRole("button", { name: "Rechazar solicitud" }).click();
      // "Rechazada" aparece dos veces a propósito: el pill de estado de la
      // solicitud y el estado del paso "Resultado" del timeline dicen
      // literalmente lo mismo (a diferencia de la colisión pending/upcoming
      // del bloque 3.1, aquí ambos SON el mismo concepto) — se toma el
      // primero (pill de estado, antes en el DOM que el timeline) en vez de
      // renombrar ninguno de los dos.
      await expect(adminPage.getByText("Rechazada", { exact: true }).first()).toBeVisible();

      await employeePage.reload();
      await expect(employeePage.getByText("Rechazada", { exact: true }).first()).toBeVisible();
      await expect(employeePage.getByText("Ya tenemos Confluence para esto.")).toBeVisible();
    } finally {
      await employeeContext.close();
      await adminContext.close();
    }
  });
});

test.describe("Motor de aprobaciones multi-paso y links firmados (bloque 3.2a)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("multi-paso: manager aprueba, avanza a finance, finance aprueba", async ({ browser }) => {
    const admin = await createOrgAdmin("multistep");
    const managerEmail = `multistep-manager-${randomSuffix()}@example.test`;
    const financeEmail = `multistep-finance-${randomSuffix()}@example.test`;
    const employeeEmail = `multistep-employee-${randomSuffix()}@example.test`;

    const managerToken = await inviteUser(admin.client, managerEmail, "manager");
    const financeToken = await inviteUser(admin.client, financeEmail, "finance");
    const employeeToken = await inviteEmployee(admin.client, employeeEmail);

    const password = "Test1234!";
    const managerApiClient = await acceptInvitationViaApi(managerToken, "Manager Aprobador", password);
    await acceptInvitationViaApi(financeToken, "Finance Aprobador", password);

    const {
      data: { user: managerAuthUser },
    } = await managerApiClient.auth.getUser();
    const { data: managerRow } = await managerApiClient
      .from("users")
      .select("id")
      .eq("auth_id", managerAuthUser!.id)
      .single();
    const departmentName = await setUpDepartmentEngine(admin.client, managerRow!.id);

    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const financeContext = await browser.newContext();
    const financePage = await financeContext.newPage();

    try {
      await employeePage.goto(`/es/invite/${employeeToken}`);
      await employeePage.getByLabel("Tu nombre completo").fill("Empleado Multipaso");
      await employeePage.getByLabel("Elige una contraseña").fill(password);
      await employeePage.getByRole("button", { name: "Unirme" }).click();
      await employeePage.waitForURL(/\/es\/dashboard$/);

      await employeePage.goto("/es/requests/new");
      const combobox = employeePage.getByRole("combobox");
      // "Salesforce" a secas matchea "Salesforce CRM" y "Salesforce Service
      // Cloud" (violación de modo estricto) — nombre exacto para desambiguar.
      await combobox.fill("salesforce crm");
      await employeePage.getByRole("option").filter({ hasText: "Salesforce CRM" }).click();
      await employeePage.getByLabel("Coste anual estimado").fill("12000");
      await employeePage.getByLabel("Moneda").fill("EUR");
      await employeePage.getByLabel("Departamento").selectOption({ label: departmentName });
      await employeePage
        .getByLabel("Justificación")
        .fill("CRM nuevo para el equipo comercial, importe por encima del tramo de manager único.");
      await employeePage.getByRole("button", { name: "Enviar solicitud" }).click();
      await employeePage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });
      const requestUrl = employeePage.url();

      await managerPage.goto("/es/login");
      await managerPage.getByLabel("Email").fill(managerEmail);
      await managerPage.getByLabel("Contraseña").fill(password);
      await managerPage.getByRole("button", { name: "Entrar" }).click();
      await managerPage.waitForURL(/\/es\/dashboard$/);
      await managerPage.goto(requestUrl);
      await managerPage.getByRole("button", { name: "Aprobar" }).click();
      await expect(managerPage.getByText("Pendiente", { exact: true })).toBeVisible();

      await financePage.goto("/es/login");
      await financePage.getByLabel("Email").fill(financeEmail);
      await financePage.getByLabel("Contraseña").fill(password);
      await financePage.getByRole("button", { name: "Entrar" }).click();
      await financePage.waitForURL(/\/es\/dashboard$/);
      await financePage.goto(requestUrl);
      await financePage.getByRole("button", { name: "Aprobar" }).click();
      await expect(financePage.getByText("Aprobada", { exact: true })).toBeVisible();

      await employeePage.reload();
      await expect(employeePage.getByText("Aprobada", { exact: true })).toBeVisible();
    } finally {
      await employeeContext.close();
      await managerContext.close();
      await financeContext.close();
    }
  });

  test("link de aprobación: aprobar sin login funciona una vez; el mismo link reintentado muestra el mensaje genérico", async ({
    browser,
  }) => {
    const admin = await createOrgAdmin("linkflow");
    const managerEmail = `linkflow-manager-${randomSuffix()}@example.test`;
    const employeeEmail = `linkflow-employee-${randomSuffix()}@example.test`;

    const managerToken = await inviteUser(admin.client, managerEmail, "manager");
    const employeeToken = await inviteEmployee(admin.client, employeeEmail);

    const password = "Test1234!";
    const managerApiClient = await acceptInvitationViaApi(managerToken, "Manager Link", password);
    const {
      data: { user: managerAuthUser },
    } = await managerApiClient.auth.getUser();
    const { data: managerRow } = await managerApiClient
      .from("users")
      .select("id")
      .eq("auth_id", managerAuthUser!.id)
      .single();
    const departmentName = await setUpDepartmentEngine(admin.client, managerRow!.id);

    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();

    try {
      await employeePage.goto(`/es/invite/${employeeToken}`);
      await employeePage.getByLabel("Tu nombre completo").fill("Empleado Link");
      await employeePage.getByLabel("Elige una contraseña").fill(password);
      await employeePage.getByRole("button", { name: "Unirme" }).click();
      await employeePage.waitForURL(/\/es\/dashboard$/);

      await employeePage.goto("/es/requests/new");
      const combobox = employeePage.getByRole("combobox");
      await combobox.fill("miro");
      await employeePage.getByRole("option").filter({ hasText: "Miro" }).click();
      await employeePage.getByLabel("Coste anual estimado").fill("1200");
      await employeePage.getByLabel("Moneda").fill("EUR");
      await employeePage.getByLabel("Departamento").selectOption({ label: departmentName });
      await employeePage.getByLabel("Justificación").fill("Pizarra colaborativa para el equipo de producto.");
      await employeePage.getByRole("button", { name: "Enviar solicitud" }).click();
      await employeePage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });

      const { data: notif, error: notifError } = await managerApiClient
        .from("notifications")
        .select("payload")
        .eq("type", "purchase_request_step_pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (notifError || !notif) throw notifError ?? new Error("no step_pending notification found for manager");
      const approvalToken = (notif.payload as { approval_token: string }).approval_token;

      const linkContext = await browser.newContext();
      const linkPage = await linkContext.newPage();
      await linkPage.goto(`/es/approvals/${approvalToken}`);
      await expect(linkPage.getByText("Miro")).toBeVisible();
      await linkPage.getByRole("button", { name: "Aprobar" }).click();
      await expect(linkPage.getByText("Solicitud aprobada. Gracias.")).toBeVisible();

      await linkPage.goto(`/es/approvals/${approvalToken}`);
      await expect(linkPage.getByText("Enlace no válido o caducado")).toBeVisible();
      await linkContext.close();

      await employeePage.reload();
      await expect(employeePage.getByText("Aprobada", { exact: true })).toBeVisible();
    } finally {
      await employeeContext.close();
    }
  });
});

test.describe("Delegaciones de aprobación (bloque 3.2b)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("delegar → el delegado aprueba vía UI → el timeline muestra 'en nombre de'", async ({ browser }) => {
    const admin = await createOrgAdmin("delegateflow");
    const managerEmail = `delegateflow-manager-${randomSuffix()}@example.test`;
    const delegateEmail = `delegateflow-delegate-${randomSuffix()}@example.test`;
    const employeeEmail = `delegateflow-employee-${randomSuffix()}@example.test`;

    const managerToken = await inviteUser(admin.client, managerEmail, "manager");
    const delegateToken = await inviteUser(admin.client, delegateEmail, "manager");
    const employeeToken = await inviteEmployee(admin.client, employeeEmail);

    const password = "Test1234!";
    const managerApiClient = await acceptInvitationViaApi(managerToken, "Manager Delegante", password);
    const delegateApiClient = await acceptInvitationViaApi(delegateToken, "Manager Delegado", password);

    const {
      data: { user: managerAuthUser },
    } = await managerApiClient.auth.getUser();
    const { data: managerRow } = await managerApiClient
      .from("users")
      .select("id")
      .eq("auth_id", managerAuthUser!.id)
      .single();
    const {
      data: { user: delegateAuthUser },
    } = await delegateApiClient.auth.getUser();
    const { data: delegateRow } = await delegateApiClient
      .from("users")
      .select("id")
      .eq("auth_id", delegateAuthUser!.id)
      .single();

    const departmentName = await setUpDepartmentEngine(admin.client, managerRow!.id);

    const { error: delegationErr } = await managerApiClient.rpc("create_approval_delegation", {
      p_delegator_user_id: managerRow!.id,
      p_delegate_user_id: delegateRow!.id,
      p_starts_on: new Date().toISOString().slice(0, 10),
      p_ends_on: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    });
    if (delegationErr) throw delegationErr;

    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    const delegateContext = await browser.newContext();
    const delegatePage = await delegateContext.newPage();

    try {
      await employeePage.goto(`/es/invite/${employeeToken}`);
      await employeePage.getByLabel("Tu nombre completo").fill("Empleado Delegación");
      await employeePage.getByLabel("Elige una contraseña").fill(password);
      await employeePage.getByRole("button", { name: "Unirme" }).click();
      await employeePage.waitForURL(/\/es\/dashboard$/);

      await employeePage.goto("/es/requests/new");
      const combobox = employeePage.getByRole("combobox");
      await combobox.fill("notion");
      await employeePage.getByRole("option").filter({ hasText: "Notion" }).click();
      await employeePage.getByLabel("Coste anual estimado").fill("1200");
      await employeePage.getByLabel("Moneda").fill("EUR");
      await employeePage.getByLabel("Departamento").selectOption({ label: departmentName });
      await employeePage.getByLabel("Justificación").fill("Documentación centralizada, prueba de delegación.");
      await employeePage.getByRole("button", { name: "Enviar solicitud" }).click();
      await employeePage.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });
      const requestUrl = employeePage.url();

      // El delegado (no el manager) aprueba — la notificación/link ya iban
      // dirigidos a él, pero aquí se ejercita la UI autenticada directamente.
      await delegatePage.goto("/es/login");
      await delegatePage.getByLabel("Email").fill(delegateEmail);
      await delegatePage.getByLabel("Contraseña").fill(password);
      await delegatePage.getByRole("button", { name: "Entrar" }).click();
      await delegatePage.waitForURL(/\/es\/dashboard$/);
      await delegatePage.goto(requestUrl);
      await delegatePage.getByRole("button", { name: "Aprobar" }).click();
      await expect(delegatePage.getByText("Aprobada", { exact: true })).toBeVisible();
      await expect(
        delegatePage.getByText(`Decidido por Manager Delegado en nombre de Manager Delegante`),
      ).toBeVisible();

      await employeePage.reload();
      await expect(employeePage.getByText("Aprobada", { exact: true })).toBeVisible();
    } finally {
      await employeeContext.close();
      await delegateContext.close();
    }
  });
});
