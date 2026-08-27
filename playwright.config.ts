import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * This image ships Chromium at a fixed path and blocks the download, so use
 * it when it is there. Anywhere else — CI, a contributor's laptop — fall
 * through to whatever `playwright install` put in place.
 */
const BUNDLED_CHROMIUM =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const launchOptions = existsSync(BUNDLED_CHROMIUM)
  ? { executablePath: BUNDLED_CHROMIUM }
  : {};

/**
 * The editor is a canvas application: almost nothing about it can be checked
 * without a real browser, so the end-to-end suite is where the important
 * guarantees live (a .docx opens, the round trip is lossless, the embed
 * answers the host). Unit tests cover the pieces underneath.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Univer boots a canvas, a worker and several presets; generous but finite.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
