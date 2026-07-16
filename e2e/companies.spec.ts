import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

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

// Flujo estrella del soporte multi-empresa (feedback de uso real,
// 2026-07-16, ver docs/DECISIONS.md): crear empresa inline desde el
// formulario de contrato → guardar contrato → verla asignada en el detalle
// del vendor y en Ajustes → Empresas.
test.describe("Soporte multi-empresa: creación inline de empresa", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("crear empresa inline desde el formulario de contrato, guardar el contrato, y verla en el detalle y en Ajustes → Empresas", async ({
    page,
  }) => {
    const setupClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `company-flow-${suffix}@example.test`;
    const password = "Test1234!";
    const companyName = `Acme Iberia SL ${suffix}`;

    const { error: signUpError } = await setupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "Company Flow",
          org_name: `Company Flow Org ${suffix}`,
          org_slug: `company-flow-${suffix}`,
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

    // 1. Añadir vendor, elegir Figma del catálogo real.
    await page.goto("/es/vendors/new");
    const combobox = page.getByRole("combobox").first();
    await combobox.fill("figm");
    await page.getByRole("option").filter({ hasText: "Figma" }).click();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Figma");

    await page.getByLabel("Owner").selectOption({ label: "Company Flow" });
    await page.getByLabel("Coste").fill("2400");
    await page.getByLabel("Moneda").fill("EUR");
    await page.getByLabel("Asientos comprados").fill("5");
    await page.getByLabel("Fecha de inicio").fill(isoDate(-10));
    await page.getByLabel("Fecha de renovación").fill(isoDate(355));

    // 2. Crear la empresa inline, sin salir del formulario.
    await page.getByRole("button", { name: "+ Nueva empresa" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nombre", { exact: true }).fill(companyName);
    await dialog.getByLabel("CIF").fill("B12345678");
    await dialog.getByRole("button", { name: "Crear empresa" }).click();
    await expect(dialog).toBeHidden();

    // Queda seleccionada en el propio selector, sin recargar el formulario.
    await expect(page.locator("#new-companyId")).toContainText(companyName);
    // El resto del formulario (owner, coste ya rellenados) sigue intacto.
    await expect(page.getByLabel("Coste")).toHaveValue("2400");

    // 3. Guardar el contrato completo (vendor + contrato + company_id).
    await page.getByRole("button", { name: "Crear vendor y contrato" }).click();
    await page.waitForURL(/\/es\/vendors\/[0-9a-f-]+$/, { timeout: 30_000 });

    // 4. Detalle del vendor: la empresa queda asignada al contrato, no
    // "Grupo / Sin asignar".
    await expect(page.getByRole("heading", { name: "Figma" })).toBeVisible();
    await expect(page.getByText(companyName, { exact: true })).toBeVisible();
    await expect(page.getByText("Grupo / Sin asignar")).toHaveCount(0);

    // 5. Ajustes → Empresas: la empresa aparece en el listado CRUD, una sola
    // vez (sin duplicados).
    await page.goto("/es/team/companies");
    const nameInputs = page.locator("li input[name='name']");
    const total = await nameInputs.count();
    let matches = 0;
    for (let i = 0; i < total; i += 1) {
      if ((await nameInputs.nth(i).inputValue()) === companyName) {
        matches += 1;
      }
    }
    expect(matches).toBe(1);
  });
});
