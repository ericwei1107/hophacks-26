import { expect, test } from "@playwright/test";

test("refresh recovers the saved build", async ({ page }) => {
  await page.goto("/");
  const payloadInput = page.getByLabel("Payload wet mass value");
  await payloadInput.fill("8000");
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForTimeout(800);
  // The edited build is restored from localStorage.
  await expect(page.getByLabel("Payload wet mass value")).toHaveValue("8000");
});

test("repeated launches work and camera/playback changes are safe", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(600);

  for (let launch = 0; launch < 2; launch++) {
    await page.getByRole("button", { name: /LAUNCH/i }).click();
    await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });

    // Cycle cameras and speeds — must not break the scene.
    await page.getByRole("button", { name: /Chase/i }).click();
    await page.getByRole("button", { name: /Orbit/i }).click();
    await page.getByRole("button", { name: /20×/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /1×/i }).click();

    // To debrief and back for another launch.
    await page.getByRole("button", { name: /DEBRIEF/i }).click();
    await expect(page.locator(".outcome h1")).toBeVisible();
    await page.getByRole("button", { name: /Return to build/i }).click();
    await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeVisible();
  }
});

test("offline weather falls back to the reference snapshot", async ({ page }) => {
  // The test environment has no route to NOAA; the app must still load and fly.
  await page.goto("/");
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 15_000 });
});
