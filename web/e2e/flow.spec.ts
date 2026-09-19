import { expect, test } from "@playwright/test";

test("complete build -> launch -> flight -> debrief -> rebuild flow", async ({ page }) => {
  await page.goto("/");

  // Assembly screen.
  await expect(page.getByRole("heading", { name: /APOGEE/i })).toBeVisible();
  const launchButton = page.getByRole("button", { name: /LAUNCH/i });
  await expect(launchButton).toBeEnabled();

  // Change a part: payload slider's number input.
  const payloadInput = page.getByLabel("Payload wet mass value");
  await payloadInput.fill("6000");
  await expect(page.getByText(/6\.0 t/)).toBeVisible();

  // Launch.
  await launchButton.click();

  // Flight screen: HUD appears after the worker returns.
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("PHASE")).toBeVisible();

  // To debrief.
  await page.getByRole("button", { name: /DEBRIEF/i }).click();
  await expect(page.locator(".outcome h1")).toBeVisible({ timeout: 5_000 });

  // Return to build.
  await page.getByRole("button", { name: /Return to build/i }).click();
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeVisible();
});
