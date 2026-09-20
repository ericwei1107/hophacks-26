import { expect, test } from "@playwright/test";

test("payload mission analysis runs from the debrief", async ({ page }) => {
  await page.goto("/lab");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /DEBRIEF/i }).click();
  await expect(page.locator(".outcome h1")).toBeVisible();

  // Payload mission analysis (baseline is instant; Monte Carlo follows).
  await page.getByRole("button", { name: /Analyze payload mission/i }).click();
  await expect(page.getByText(/Payload three-year mission/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Baseline mission/i)).toBeVisible();

  // Monte Carlo completes in the worker.
  await expect(page.getByText(/Monte Carlo/i)).toBeVisible({ timeout: 60_000 });

  // Robustness analysis.
  await page.getByRole("button", { name: /Run robustness analysis/i }).click();
  await expect(page.getByText(/Ascent robustness/i)).toBeVisible({ timeout: 60_000 });
});
