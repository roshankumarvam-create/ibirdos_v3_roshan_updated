// =====================================================================
// Smoke e2e: signup → login → see dashboard
// =====================================================================
import { test, expect } from "@playwright/test";

test.describe("auth smoke", () => {
  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/some-workspace");
    await expect(page).toHaveURL(/.*\/login.*/);
  });

  test("displays signup form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /sign up|create/i })).toBeVisible();
  });

  test("displays login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in|log in/i })).toBeVisible();
  });
});
