import { readEnvironment } from "@keycade/config/server";
import { defineConfig, devices } from "@playwright/test";

const env = readEnvironment();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `http://127.0.0.1:${env.API_PORT ?? 4000}/api/ready`,
    reuseExistingServer: !process.env.CI,
    // Let scripts/dev.ts forward shutdown to its detached Turbo process group.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 120_000,
  },
});
