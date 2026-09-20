import { expect, test } from "@playwright/test";

test("complete build -> launch -> flight -> debrief -> rebuild flow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: /LAUNCH/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Enter Launch Lab", exact: true }).first().click();
  await expect(page).toHaveURL(/\/lab$/);

  // Assembly screen.
  await expect(page.getByRole("heading", { name: /Launch Lab/i })).toBeVisible();
  const launchButton = page.getByRole("button", { name: /LAUNCH/i });
  await expect(launchButton).toBeEnabled();

  // Change a part: payload slider's number input.
  const payloadInput = page.getByLabel("Mission payload (dry) value");
  await payloadInput.fill("6000");
  await expect(page.locator(".control-value", { hasText: "6.0 t" })).toBeVisible();

  // Launch.
  await launchButton.click();

  // Flight screen: HUD appears after the worker returns.
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("PHASE")).toBeVisible();

  // Natural playback completion automatically opens the debrief.
  const scrubber = page.getByLabel("Scrub flight");
  const duration = Number(await scrubber.getAttribute("max"));
  const nearEnd = Math.floor((duration - 0.2) / 0.05) * 0.05;
  await scrubber.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, nearEnd.toFixed(2));
  await expect(page.locator(".outcome h1")).toBeVisible({ timeout: 5_000 });

  // Return to build.
  await page.getByRole("button", { name: /Return to build/i }).click();
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeVisible();

  // Editing a completed run restores the narrated stale-analysis notice.
  await page.getByLabel("Mission payload (dry) value").fill("6500");
  const staleNotice = page.locator(".narrated-text").filter({ hasText: "prior analysis invalidated" });
  await expect(staleNotice).toBeVisible();
  await expect(staleNotice.locator(".narration-button")).toHaveCount(1);
});
