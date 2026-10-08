import { readEnvironment } from "@keycade/config/server";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const env = readEnvironment();
if (env.KEYCADE_E2E_HOSTED !== "true" || env.DEMO_INBOX_ENABLED !== "true")
  throw new Error("Hosted acceptance requires explicit hosted mode and simulated inbox delivery.");
for (const key of ["KEYCADE_E2E_BORROWER_ORIGIN", "KEYCADE_E2E_STAFF_ORIGIN"]) {
  const value = env[key];
  if (!value) throw new Error("Hosted acceptance requires both explicit portal origins.");
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.origin !== value || origin.username || origin.password)
    throw new Error("Hosted acceptance portal origins must be HTTPS origins without credentials.");
}

export default defineConfig({
  ...base,
  testMatch: [
    "demo-inbox.spec.ts",
    "hosted-demo.spec.ts",
    "closing.spec.ts",
    "hosted-enrichment.spec.ts",
    "hosted-v2.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  expect: { timeout: 30_000 },
  webServer: undefined,
  projects: base.projects?.filter((project) => project.name === "desktop"),
  use: { ...base.use, trace: "off", screenshot: "off", video: "off", actionTimeout: 25_000 },
});
