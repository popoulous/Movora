import { expect, test } from "@playwright/test";

// The API is mocked, so this exercises the real built SPA's login gate in a browser.
test("shows the login gate and accepts credentials", async ({ page }) => {
  await page.route("**/api/auth/status*", (route) =>
    route.fulfill({ json: { authenticated: false, needs_setup: false, user: null } }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Movora" })).toBeVisible();
  const username = page.locator('input[autocomplete="username"]');
  await username.fill("admin");
  await expect(username).toHaveValue("admin");
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button")).toBeVisible();
});
