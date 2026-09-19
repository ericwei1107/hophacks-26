import { expect, test, type Page } from "@playwright/test";

/**
 * The launch view is swappable, and the swap has to be invisible to everything
 * else on the screen. These cover the parts of that which are observable
 * without a Unity build deployed: lazy loading, the fallback, and the fact that
 * scrubbing stays clean.
 */

function trackUnityRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/unity/")) {
      requests.push(request.url());
    }
  });
  return requests;
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

test("the build screen never touches the Unity build", async ({ page }) => {
  const unityRequests = trackUnityRequests(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: /LAUNCH/i })).toBeEnabled();
  await page.getByLabel("Payload wet mass value").fill("7000");
  await page.waitForTimeout(500);

  expect(unityRequests, "the build screen must not wait on a Unity download").toEqual([]);
});

test("the launch view falls back to three.js when no Unity build is deployed", async ({ page }) => {
  await page.goto("/?renderer=unity");
  await page.getByRole("button", { name: /LAUNCH/i }).click();

  // Well inside the 30 s load timeout: the probe fails immediately.
  await expect(page.locator(".renderer-badge")).toHaveText("THREE", { timeout: 30_000 });
  await expect(page.locator(".renderer-notice")).toBeVisible();
  await expect(page.getByText("ALTITUDE")).toBeVisible();
});

test("?renderer=three forces the fallback and asks for nothing from Unity", async ({ page }) => {
  const unityRequests = trackUnityRequests(page);

  await page.goto("/?renderer=three");
  await page.getByRole("button", { name: /LAUNCH/i }).click();

  await expect(page.locator(".renderer-badge")).toHaveText("THREE");
  // An explicit choice is not a failure, so there is nothing to report.
  await expect(page.locator(".renderer-notice")).toHaveCount(0);
  expect(unityRequests).toEqual([]);
});

test("scrubbing back and forth leaves the view healthy", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto("/?renderer=three");
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 20_000 });

  const scrubber = page.getByLabel("Scrub flight");
  await page.getByRole("button", { name: /Pause/i }).click();

  for (const t of ["300", "20", "180", "5", "420", "60"]) {
    await scrubber.fill(t);
    await page.waitForTimeout(120);
  }

  // The HUD still tracks the scrubber rather than freezing at the last value.
  await scrubber.fill("0");
  await page.waitForTimeout(250);
  const altitude = await page.locator(".hud-item", { hasText: "ALTITUDE" }).innerText();
  expect(altitude).toMatch(/0\.0\s*km/);

  expect(errors).toEqual([]);
});

test("camera modes and zoom stay responsive through a flight", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto("/?renderer=three");
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 20_000 });

  for (const mode of ["Chase", "Ground", "Orbit", "Overhead"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await page.waitForTimeout(150);
  }

  await page.getByRole("button", { name: "Zoom out from rocket" }).click();
  await page.getByRole("button", { name: "Zoom in on rocket" }).click();
  await page.getByRole("button", { name: "Zoom in on rocket" }).click();
  await expect(page.locator(".zoom-readout")).toContainText("×");

  // Dragging the viewport orbits the camera; it must not throw or select text.
  const viewport = page.locator(".viewport");
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(errors).toEqual([]);
});

test("typing in HTML controls still works with the launch view on the page", async ({ page }) => {
  await page.goto("/?renderer=three");
  await page.getByRole("button", { name: /LAUNCH/i }).click();
  await expect(page.getByText("ALTITUDE")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /DEBRIEF/i }).click();
  await page.getByRole("button", { name: /Return to build/i }).click();

  const payload = page.getByLabel("Payload wet mass value");
  await payload.fill("8200");
  await expect(payload).toHaveValue("8200");

  // Keystrokes, not just programmatic value changes, have to reach the input:
  // a renderer that captures all keyboard input would swallow these.
  await payload.focus();
  await payload.press("ArrowUp");
  await expect(payload).toHaveValue("8300");
});

test("a Unity build that throws at startup falls back within the load timeout", async ({ page }) => {
  // Pretend WebGPU exists, serve a build that looks real, and make its loader
  // fail — the path the fallback exists for.
  await page.addInitScript(() => {
    if (!("gpu" in navigator)) {
      Object.defineProperty(navigator, "gpu", { value: {}, configurable: true });
    }
  });

  await page.route("**/unity/index.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<script>
        var buildUrl = "Build";
        var loaderUrl = buildUrl + "/RocketRenderer.loader.js";
        var config = {
          dataUrl: buildUrl + "/RocketRenderer.data",
          frameworkUrl: buildUrl + "/RocketRenderer.framework.js",
          codeUrl: buildUrl + "/RocketRenderer.wasm",
        };
      </script>`,
    }),
  );
  await page.route("**/unity/Build/**", (route) => route.fulfill({ status: 500, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: /LAUNCH/i }).click();

  await expect(page.locator(".renderer-badge")).toHaveText("THREE", { timeout: 30_000 });
  await expect(page.locator(".renderer-notice")).toContainText(/failed to start/i);
  await expect(page.getByText("ALTITUDE")).toBeVisible();
});
