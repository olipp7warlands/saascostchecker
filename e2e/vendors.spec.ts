import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

// Playwright siempre corre desde la raíz del proyecto (mismo cwd que
// playwright.config.ts) — evita import.meta.url a propósito, dispara un bug
// de interop ESM/CJS en el loader de esta versión de Playwright.
const SAMPLE_PDF_PATH = path.resolve(process.cwd(), "e2e/fixtures/sample-contract.pdf");

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

test.describe("Alta de vendor + contrato (bloque 1.2)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("crear vendor desde el catálogo + contrato con PDF en menos de 1 minuto", async ({
    page,
  }) => {
    const setupClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `vendor-flow-${suffix}@example.test`;
    const password = "Test1234!";

    const { error: signUpError } = await setupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "Vendor Flow",
          org_name: `Vendor Flow Org ${suffix}`,
          org_slug: `vendor-flow-${suffix}`,
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

    const start = Date.now();

    await page.goto("/es/vendors/new");

    const combobox = page.getByRole("combobox");
    await combobox.fill("figm");
    await page.getByRole("option").filter({ hasText: "Figma" }).click();

    // Los campos del vendor se rellenan solos desde el catálogo.
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Figma");

    await page.getByLabel("Owner").selectOption({ label: "Vendor Flow" });

    await page.getByLabel("Coste").fill("9120");
    await page.getByLabel("Moneda").fill("EUR");
    // Ciclo de facturación: se deja el valor por defecto (Anual).
    await page.getByLabel("Asientos comprados").fill("19");
    await page.getByLabel("Fecha de inicio").fill(isoDate(-30));
    await page.getByLabel("Fecha de renovación").fill(isoDate(300));
    await page.getByLabel("Contrato en PDF").setInputFiles(SAMPLE_PDF_PATH);

    await page.getByRole("button", { name: "Crear vendor y contrato" }).click();

    await page.waitForURL(/\/es\/vendors\/[0-9a-f-]+$/, { timeout: 30_000 });
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(60_000);

    await expect(page.getByRole("heading", { name: "Figma" })).toBeVisible();
    // El botón de PDF vive en la pestaña Documentos desde el rediseño de la
    // ficha con tabs (2026-07-16), ya no en la vista por defecto (Detalles).
    await page.getByRole("tab", { name: "Documentos" }).click();
    await expect(page.getByRole("button", { name: "Ver PDF" })).toBeVisible();

    await page.goto("/es/vendors");
    const row = page.getByRole("row", { name: /Figma/ });
    await expect(row).toBeVisible();
    // Intl.NumberFormat("es", ...) para 9120 € no agrupa con "." en este
    // entorno (el CLDR de es-ES solo agrupa a partir de 5 dígitos) — se
    // comprueba la cifra en bruto, no una agrupación visual específica.
    await expect(row.getByText("9120")).toBeVisible();
    await expect(row.getByText("19")).toBeVisible();
    await expect(row.getByText("Vendor Flow")).toBeVisible();
  });
});
