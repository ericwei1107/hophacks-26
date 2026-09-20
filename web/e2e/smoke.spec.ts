import { expect, test } from "@playwright/test";

test("app shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Light does not leave here/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Enter Launch Lab", exact: true }).first().click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeVisible();
});
