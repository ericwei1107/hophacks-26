import { expect, test } from "@playwright/test";

test("payload mission analysis runs from the debrief", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/lab");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /DEBRIEF/i }).click();
  await expect(page.locator(".outcome h1")).toBeVisible();

  // Payload mission analysis (baseline is instant; Monte Carlo follows).
  await page.getByRole("button", { name: /Analyze payload mission/i }).click();
  await expect(page.getByRole("heading", { name: /Three-year mission/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".stat-label", { hasText: "Baseline" })).toBeVisible();
  await expect(page.getByText(/Monte Carlo/i)).toBeVisible({ timeout: 60_000 });
  const payloadReport = page.locator("section.analysis.report").filter({
    has: page.getByRole("heading", { name: /Three-year mission/i }),
  });
  await expect.poll(() => payloadReport.locator(".narration-button").count()).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: /Run robustness analysis/i }).click();
  await expect(page.getByRole("heading", { name: /^Robustness$/i })).toBeVisible({ timeout: 60_000 });
  const robustnessReport = page.locator("section.analysis.report").filter({
    has: page.getByRole("heading", { name: /^Robustness$/i }),
  });
  await expect(robustnessReport.locator(".narration-button")).toHaveCount(2);
});
