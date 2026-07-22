import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { devices, expect, test } from "@playwright/test";

// Emulación real de dispositivo (Galaxy S8, isMobile+hasTouch), no solo una
// ventana de escritorio redimensionada — un viewport estrecho sin
// isMobile/hasTouch no reproduce el bug real que motivó esta suite: Chromium
// móvil ensancha el "layout viewport" de toda la página cuando encuentra
// contenido ancho, incluso si ya está contenido en un overflow-x-auto
// (ver docs/DECISIONS.md, sesión de fixes de móvil).
test.use({ ...devices["Galaxy S8"] });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

type Tenant = { client: SupabaseClient; userId: string; email: string };

function newAnonClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signUpOrg(label: string): Promise<Tenant> {
  const client = newAnonClient();
  const suffix = randomSuffix();
  const email = `${label}-${suffix}@example.test`;

  const { data, error } = await client.auth.signUp({
    email,
    password: "Test1234!",
    options: {
      data: {
        full_name: `${label} Owner`,
        org_name: `${label} Inc`,
        org_slug: `${label}-${suffix}`,
        default_currency: "EUR",
        locale: "es",
      },
    },
  });
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
  return { client, userId: data.user.id, email };
}

async function inviteAndAccept(orgAdmin: Tenant, role: string, label: string): Promise<Tenant> {
  const suffix = randomSuffix();
  const email = `${label}-${suffix}@example.test`;
  const tokenHash = `${label}-${suffix}`.padEnd(64, "0");

  const { error: inviteError } = await orgAdmin.client.rpc("create_invitation", {
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
    p_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (inviteError) throw inviteError;

  const client = newAnonClient();
  const { data, error } = await client.auth.signUp({
    email,
    password: "Test1234!",
    options: { data: { full_name: `${label} User`, invitation_token_hash: tokenHash } },
  });
  if (error || !data.user) throw error ?? new Error("signUp did not return a user");
  return { client, userId: data.user.id, email };
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/es/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/es\/dashboard$/);
}

async function hasNoHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test.describe("Móvil: sin scroll horizontal + nav completo (bloque de fixes de móvil)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("dashboard, vendors, ficha de vendor, renovaciones y presupuestos caben en un viewport de 360px", async ({
    page,
  }) => {
    const admin = await signUpOrg("mobile-overflow");

    const { data: companyId, error: companyError } = await admin.client.rpc("create_company", {
      p_name: "Acme Iberia Holding SL",
      p_tax_id: null,
      p_is_default: false,
    });
    if (companyError || !companyId) throw companyError ?? new Error("create_company failed");

    const { data: vendorId, error: vendorError } = await admin.client.rpc("create_vendor", {
      p_catalog_id: null,
      p_name: "Figma",
      p_website: "figma.com",
      p_category: "design",
      p_owner_user_id: null,
      p_is_custom: true,
      p_notes: null,
    });
    if (vendorError || !vendorId) throw vendorError ?? new Error("create_vendor failed");

    // Peor caso de contract-list.tsx: activo + pospuesto + compañía asignada
    // (3 pills + kebab), el caso que exponía el bug de la fila compacta.
    const { data: contractId, error: contractError } = await admin.client.rpc("create_contract", {
      p_vendor_id: vendorId,
      p_name: "Figma contract",
      p_cost_amount: 9120,
      p_currency: "EUR",
      p_billing_cycle: "annual",
      p_seats_purchased: 19,
      p_start_date: isoDate(-300),
      p_renewal_date: isoDate(5),
      p_auto_renews: true,
      p_cancellation_notice_days: 30,
      p_document_url: null,
      p_department_id: null,
      p_company_id: companyId,
    });
    if (contractError || !contractId) throw contractError ?? new Error("create_contract failed");

    const { error: snoozeError } = await admin.client.rpc("set_contract_snooze", {
      p_contract_id: contractId,
      p_snoozed_until: isoDate(14),
    });
    if (snoozeError) throw snoozeError;

    await login(page, admin.email, "Test1234!");

    for (const path of [
      "/es/dashboard",
      "/es/vendors",
      `/es/vendors/${vendorId}`,
      "/es/renewals",
      "/es/team/budgets",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await hasNoHorizontalOverflow(page), `${path} desborda el viewport móvil`).toBe(true);
    }

    // El caso específico que rompía contract-list.tsx: pestaña Contratos con
    // el contrato pospuesto + compañía asignada.
    await page.goto(`/es/vendors/${vendorId}`);
    await page.getByRole("tab", { name: "Contratos" }).click();
    await page.waitForTimeout(200);
    expect(await hasNoHorizontalOverflow(page), "pestaña Contratos desborda el viewport móvil").toBe(
      true,
    );
  });

  test("bottom nav: 4 fijas + \"Más\" con el resto, org_admin ve todo", async ({ page }) => {
    const admin = await signUpOrg("mobile-nav-admin");
    await login(page, admin.email, "Test1234!");

    const bottomNav = page.getByRole("navigation", { name: "Navegación móvil" });
    await expect(bottomNav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Vendors" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Renovaciones" })).toBeVisible();
    await expect(bottomNav.getByText("Solicitudes")).toBeVisible();
    const moreButton = bottomNav.getByRole("button", { name: "Más" });
    await expect(moreButton).toBeVisible();

    await moreButton.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Datos", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Ajustes", { exact: true })).toBeVisible();
    for (const label of [
      "Importar gasto",
      "Reconciliación",
      "Presupuestos",
      "Equipo y reglas",
      "Empresas",
      "Departamentos",
      "Notificaciones",
    ]) {
      await expect(sheet.getByRole("link", { name: label })).toBeVisible();
    }

    await sheet.getByRole("link", { name: "Presupuestos" }).click();
    await page.waitForURL(/\/es\/team\/budgets$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("\"Más\" respeta permisos de rol: finance no ve la sección Ajustes", async ({ page }) => {
    const admin = await signUpOrg("mobile-nav-role");
    const member = await inviteAndAccept(admin, "finance", "mobile-nav-finance");

    await login(page, member.email, "Test1234!");
    const bottomNav = page.getByRole("navigation", { name: "Navegación móvil" });
    await bottomNav.getByRole("button", { name: "Más" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Datos", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Presupuestos" })).toBeVisible();
    // finance no es org_admin: la sección "Ajustes" completa no debe existir.
    await expect(sheet.getByText("Ajustes", { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "Empresas" })).toHaveCount(0);
  });
});
