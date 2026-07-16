import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

test.describe("Home pública", () => {
  test("carga en español con el hero, la pista de renovaciones demo y el CTA", async ({ page }) => {
    await page.goto("/es");
    await expect(page.getByRole("heading", { name: /Cada euro de tu software/ })).toBeVisible();
    await expect(page.getByText("Tu pista de renovaciones", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Empezar gratis" }).first()).toBeVisible();
  });

  test("carga en inglés", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { name: /Every euro of your software/ })).toBeVisible();
    await expect(page.getByText("Your renewals runway", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start for free" }).first()).toBeVisible();
  });

  test("los CTAs navegan a signup y login", async ({ page }) => {
    await page.goto("/es");
    await page.getByRole("link", { name: "Crear organización" }).click();
    await expect(page).toHaveURL(/\/es\/signup$/);

    await page.goto("/es");
    await page.getByRole("link", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test("las anclas de la nav funcionan", async ({ page }) => {
    await page.goto("/es");
    await page.getByRole("link", { name: "Cómo funciona", exact: true }).click();
    await expect(page).toHaveURL(/\/es#como$/);
    await expect(page.getByRole("heading", { name: "De extracto bancario a control total, en tres pasos." })).toBeInViewport();
  });

  test("en móvil (<640px) la pista de renovaciones es una lista vertical con Salesforce completo y sin cortar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/es");

    // Lista vertical: el hint "ordenado por días restantes" está visible,
    // los ticks de escala (7d/30d/...) de la franja horizontal no.
    await expect(page.getByText("ordenado por días restantes")).toBeVisible();
    await expect(page.getByText("120d")).toBeHidden();

    // El texto existe dos veces en el DOM (rama móvil visible + rama
    // desktop oculta con `hidden`) — .and(':visible') se queda solo con la
    // instancia realmente visible en este viewport.
    const salesforceWarning = page.getByText("auto-renueva en 5 días").and(page.locator(":visible"));
    await expect(salesforceWarning).toBeVisible();
    const box = await salesforceWarning.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });

  test("en desktop (>=640px) la pista de renovaciones sigue siendo la franja horizontal con ticks", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/es");

    await expect(page.getByText("posición = días restantes")).toBeVisible();
    await expect(page.getByText("120d")).toBeVisible();
  });

  test("con sesión activa, redirige a /dashboard antes de renderizar", async ({ page }) => {
    test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

    const client: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `home-redirect-${suffix}@example.test`;

    const { error } = await client.auth.signUp({
      email,
      password: "Test1234!",
      options: {
        data: {
          full_name: "Home Redirect Owner",
          org_name: `Home Redirect Inc ${suffix}`,
          org_slug: `home-redirect-${suffix}`,
          default_currency: "EUR",
          locale: "es",
        },
      },
    });
    if (error) throw error;

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill("Test1234!");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    await page.goto("/es");
    await expect(page).toHaveURL(/\/es\/dashboard$/);
  });
});
