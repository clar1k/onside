import { test, expect } from "@playwright/test";

test("home lists real World Cup fixtures, at least one with markets", async ({ page }) => {
  await page.goto("/");
  // Real TxODDS fixtures load through the server proxy.
  await expect(page.locator('a[href^="/fixture/"]').first()).toBeVisible({ timeout: 60_000 });
  // The seeded fixture shows a markets chip (count from getProgramAccounts).
  await expect(page.getByText(/\d+ markets/).first()).toBeVisible({ timeout: 60_000 });
});
