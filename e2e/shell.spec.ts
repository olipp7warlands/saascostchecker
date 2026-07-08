import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Estos tests crean usuarios/orgs reales (signUp + RPC create_invitation) y solo
// deben correr contra la instancia LOCAL de Supabase — igual que
// rls-isolation.test.ts/permissions.test.ts. Si no está disponible (p.ej. un
// `pnpm test:e2e` local sin `supabase start`), se skippean en vez de fallar.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

async function createOrgAdmin() {
  const client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const suffix = randomSuffix();
  const email = `shell-admin-${suffix}@example.test`;
  const password = "Test1234!";

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: "Admin Shell",
        org_name: `Shell Org ${suffix}`,
        org_slug: `shell-org-${suffix}`,
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

async function inviteEmployee(adminClient: SupabaseClient, email: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await adminClient.rpc("create_invitation", {
    p_email: email,
    p_role: "employee",
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error) {
    throw error;
  }

  return rawToken;
}

test.describe("Shell de la aplicación (bloque 0.4)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("cambia de idioma dentro del shell sin perder la ruta", async ({ page }) => {
    const { email, password } = await createOrgAdmin();

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    await page.goto("/es/team/members");
    await expect(page.getByRole("heading", { name: "Miembros del equipo" })).toBeVisible();

    const localeSwitcher = page.getByRole("group", { name: "Idioma" });
    await localeSwitcher.getByRole("link", { name: "EN" }).click();

    await expect(page).toHaveURL(/\/en\/team\/members$/);
    await expect(page.getByRole("heading", { name: "Team members" })).toBeVisible();
  });

  test("un empleado no ve las entradas de administración", async ({ page }) => {
    const admin = await createOrgAdmin();
    const employeeEmail = `shell-employee-${randomSuffix()}@example.test`;
    const rawToken = await inviteEmployee(admin.client, employeeEmail);

    await page.goto(`/es/invite/${rawToken}`);
    await page.getByLabel("Tu nombre completo").fill("Empleado Test");
    await page.getByLabel("Elige una contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Unirme" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    const mainNav = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(mainNav).toBeVisible();
    await expect(mainNav.getByText("Equipo y reglas")).toHaveCount(0);
    await expect(mainNav.getByText("Ajustes")).toHaveCount(0);
    await expect(mainNav.getByText("Dashboard")).toBeVisible();
    await expect(mainNav.getByText("Solicitudes")).toBeVisible();

    // La página en sí sigue protegida server-side aunque el shell se renderice.
    await page.goto("/es/team/members");
    await expect(page.getByText("Solo un administrador puede gestionar usuarios")).toBeVisible();
  });
});
