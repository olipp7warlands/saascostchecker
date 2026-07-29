import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

test.describe("Solicitudes self-service (bloque 3.1)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("empleado crea una solicitud con el catálogo real y la ve en su lista", async ({ page }) => {
    const setupClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `request-flow-${suffix}@example.test`;
    const password = "Test1234!";

    const { error: signUpError } = await setupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "Request Flow",
          org_name: `Request Flow Org ${suffix}`,
          org_slug: `request-flow-${suffix}`,
          default_currency: "EUR",
          locale: "es",
        },
      },
    });
    expect(signUpError).toBeNull();

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    // Nav: "Solicitudes" ya no es un placeholder deshabilitado (bloque 3.1).
    await page.goto("/es/requests/new");

    const combobox = page.getByRole("combobox");
    await combobox.fill("figm");
    await page.getByRole("option").filter({ hasText: "Figma" }).click();

    await page.getByLabel("Coste anual estimado").fill("1200");
    await page.getByLabel("Moneda").fill("EUR");
    await page
      .getByLabel("Justificación")
      .fill("Necesitamos una herramienta de diseño compartida para el equipo de producto.");
    await page.getByLabel("Alternativas consideradas").fill("Sketch, Adobe XD");

    await page.getByRole("button", { name: "Enviar solicitud" }).click();

    await page.waitForURL(/\/es\/requests\/[0-9a-f-]+$/, { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Figma" })).toBeVisible();
    await expect(page.getByText("Pendiente", { exact: true })).toBeVisible();
    // Timeline: recién enviada, el paso "En revisión" es el que está en curso.
    const reviewRow = page.getByText("En revisión", { exact: true }).locator("..");
    await expect(reviewRow.getByText("En curso", { exact: true })).toBeVisible();

    await page.goto("/es/requests");
    const row = page.getByRole("row", { name: /Figma/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("Pendiente", { exact: true })).toBeVisible();
  });
});
