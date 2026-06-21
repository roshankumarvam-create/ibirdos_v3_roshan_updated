import { test, expect } from "@playwright/test";

test.describe("daily sales — unauthenticated guards", () => {
  test("new page redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/some-workspace/daily-sales/new");
    await expect(page).toHaveURL(/.*\/login.*/);
  });

  test("detail page redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/some-workspace/daily-sales/some-id");
    await expect(page).toHaveURL(/.*\/login.*/);
  });

  test("list page redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/some-workspace/daily-sales");
    await expect(page).toHaveURL(/.*\/login.*/);
  });
});

/*
 * Manual verification required for authenticated flows (requires credentials):
 *
 * ITEM 1 — Create redirects to list, no double-save:
 *   1. Log in and navigate to /[workspace]/daily-sales/new
 *   2. Fill in required fields (date, gross, net, tax), click Save
 *   3. Verify: success toast "Daily sales saved successfully." appears
 *   4. Verify: browser lands on /[workspace]/daily-sales (list page)
 *   5. Verify: NO navigation to /[workspace]/daily-sales/{id} happens
 *
 * ITEM 1 — View/edit modes on detail page:
 *   1. Click any row on the list page
 *   2. Verify: lands on /[workspace]/daily-sales/{id} in VIEW mode (read-only, no form inputs)
 *   3. Verify: "Edit" button is visible
 *   4. Click Edit — verify form becomes editable
 *   5. Change a field, click Save
 *   6. Verify: success toast "Daily sales updated successfully." appears
 *   7. Verify: browser lands on /[workspace]/daily-sales (list page)
 *   8. Click a row again, click Edit, click Cancel — verify form reverts to view mode
 *
 * ITEM 2 — Variance status columns:
 *   1. On list page, verify "Bal. Status" and "Variance" column headers exist
 *   2. For a balanced row: "Balanced" label (green) and "—" variance
 *   3. For an unbalanced row: "Variance" or "Significant Variance" label with dollar amount
 *   4. On detail/edit page, verify VarianceStatus component shows label + amount
 *   5. On new entry page, as tender amounts are typed, live indicator updates tier label
 */
