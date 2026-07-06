import { expect, test } from "@playwright/test";

test("renders the Spanish homepage with brand tokens", async ({ page }) => {
  await page.goto("/es");
  await expect(page.getByRole("heading", { name: "Stackly" })).toBeVisible();
  await expect(page.getByText("Fase 0 · Bloque 0.1")).toBeVisible();
});

test("renders the English homepage", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "Stackly" })).toBeVisible();
  await expect(page.getByText("Phase 0 · Block 0.1")).toBeVisible();
});

test("switches locale via the language links", async ({ page }) => {
  await page.goto("/es");
  await page.getByRole("link", { name: "EN" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByText("Phase 0 · Block 0.1")).toBeVisible();
});
