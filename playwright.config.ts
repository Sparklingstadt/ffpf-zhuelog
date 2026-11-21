import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { baseURL } from "./e2e/environment";

process.env.ZHUELOG_E2E_SECRET ??= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // The dedicated database is reset before each test.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      // anyWidth tests (e2e/fixtures.ts) give the same result at any width.
      grepInvert: /@any-width/,
    },
  ],
  webServer: {
    command: "node --import tsx e2e/server.ts",
    url: `${baseURL}/signin`,
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 180_000,
  },
});
