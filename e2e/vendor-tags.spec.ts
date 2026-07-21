import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const usesLocalSupabase = !!supabaseUrl && /127\.0\.0\.1|localhost/.test(supabaseUrl);

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

test.describe("Tags por vendor (bloque nuevo: tags + presupuestos)", () => {
  test.skip(!usesLocalSupabase, "Requiere Supabase local — ver docs/DECISIONS.md");

  test("añadir y quitar un tag desde la ficha del vendor, y filtrar el listado por tag", async ({
    page,
  }) => {
    const setupClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomSuffix();
    const email = `tag-flow-${suffix}@example.test`;
    const password = "Test1234!";

    const { error: signUpError } = await setupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "Tag Flow",
          org_name: `Tag Flow Org ${suffix}`,
          org_slug: `tag-flow-${suffix}`,
          default_currency: "EUR",
          locale: "es",
        },
      },
    });
    expect(signUpError).toBeNull();

    const taggedVendorName = `Tagged Vendor ${suffix}`;
    const untaggedVendorName = `Untagged Vendor ${suffix}`;
    const tag = `procurement-${suffix}`;

    const { data: taggedVendorId, error: taggedVendorError } = await setupClient.rpc(
      "create_vendor",
      {
        p_catalog_id: null,
        p_name: taggedVendorName,
        p_website: "example.test",
        p_category: "other",
        p_owner_user_id: null,
        p_is_custom: true,
        p_notes: null,
      },
    );
    expect(taggedVendorError).toBeNull();

    const { error: untaggedVendorError } = await setupClient.rpc("create_vendor", {
      p_catalog_id: null,
      p_name: untaggedVendorName,
      p_website: "example.test",
      p_category: "other",
      p_owner_user_id: null,
      p_is_custom: true,
      p_notes: null,
    });
    expect(untaggedVendorError).toBeNull();

    await page.goto("/es/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/es\/dashboard$/);

    // 1. Añadir un tag desde la ficha del vendor.
    await page.goto(`/es/vendors/${taggedVendorId}`);
    const tagInput = page.getByLabel("Tags", { exact: true });
    await tagInput.fill(tag);
    await tagInput.press("Enter");

    const chip = page.getByText(tag, { exact: true });
    await expect(chip).toBeVisible();
    // Persiste tras recargar (RPC real, no solo estado optimista local).
    await page.reload();
    await expect(page.getByText(tag, { exact: true })).toBeVisible();

    // 2. Filtrar /vendors por ese tag: solo el vendor etiquetado aparece.
    await page.goto("/es/vendors");
    await page.getByLabel("Filtrar por tag").selectOption(tag);
    await expect(page.getByRole("link", { name: taggedVendorName })).toBeVisible();
    await expect(page.getByRole("link", { name: untaggedVendorName })).toHaveCount(0);

    await page.getByLabel("Filtrar por tag").selectOption("");
    await expect(page.getByRole("link", { name: untaggedVendorName })).toBeVisible();

    // 3. Quitar el tag desde la ficha; deja de aparecer en el filtro.
    await page.goto(`/es/vendors/${taggedVendorId}`);
    await page.getByRole("button", { name: `Quitar tag ${tag}` }).click();
    await expect(page.getByText(tag, { exact: true })).toHaveCount(0);

    await page.goto("/es/vendors");
    await expect(page.getByLabel("Filtrar por tag").locator(`option[value="${tag}"]`)).toHaveCount(0);
  });
});
