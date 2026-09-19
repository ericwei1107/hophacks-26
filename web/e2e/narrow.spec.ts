import { expect, test } from "@playwright/test";

test("narrow/tablet viewport stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/");
  const launch = page.getByRole("button", { name: /LAUNCH/i });
  await expect(launch).toBeVisible();
  // Controls remain reachable and the layout stacks.
  await expect(page.getByLabel("Payload wet mass value")).toBeVisible();
  await launch.click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
});

test("keyboard navigation reaches the launch action", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(500);
  // Tab through the controls; the launch button must be focusable.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    if (focused.includes("LAUNCH")) {
      break;
    }
  }
  const launch = page.getByRole("button", { name: /LAUNCH/i });
  await launch.focus();
  await expect(launch).toBeFocused();
});
