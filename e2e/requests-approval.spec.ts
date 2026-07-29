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
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await adminClient.rpc("create_invitation", {
    p_email: email,
    p_role: "employee",
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });
  if (error) throw error;

  return rawToken;
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
