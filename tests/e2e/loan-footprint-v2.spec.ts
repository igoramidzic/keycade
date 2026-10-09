import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { ApplicationSetup, BusinessAddress, ChecksView } from "@keycade/contracts";
import { expect, type Page, test } from "@playwright/test";
import { workflowApi } from "./closing-helpers";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const registeredAddress: BusinessAddress = {
  line1: "123 Synthetic Avenue",
  locality: "Portland",
  region: "ME",
  postalCode: "04101",
  countryCode: "US",
};
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

async function signIn(page: Page) {
  await page.goto(staff);
  await fillSignInEmail(page, "officer-a@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
}

async function draft(page: Page, address?: BusinessAddress) {
  return workflowApi<ApplicationSetup>(page, "POST", "/applications", {
    idempotencyKey: randomUUID(),
    email: `footprint-${randomUUID()}@example.test`,
    answers: {
      businessName: "Synthetic Footprint Workshop",
      ...(address ? { businessAddress: address } : {}),
    },
  });
}

async function open(page: Page, applicationId: string, section = "overview") {
  await page.goto(`${staff}/applications/${applicationId}/${section}?bank=bank-a`);
  const trigger = page.getByRole("button", { name: "Loan Footprint", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Geographic Eligibility", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("registered US footprint opens from Overview and Checks with keyboard focus and no external map requests", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      external.push(url.hostname);
  });
  await signIn(page);
  const app = await draft(page, registeredAddress);
  const { dialog, trigger } = await open(page, app.id);
  await expect(dialog.getByText("Within the US lending footprint.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog).toContainText("123 Synthetic Avenue");
  await expect(dialog).toContainText("US footprint · v1");
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect(dialog).not.toContainText("Map location unavailable");
  await noOverflow(page);
  await dialog.screenshot({ path: testInfo.outputPath("synthetic-footprint-map.png") });
  await dialog.getByRole("img").scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "Close geographic eligibility", exact: true }),
  ).toBeInViewport();
  await dialog
    .getByRole("img")
    .screenshot({ path: testInfo.outputPath("synthetic-footprint-pin.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const checks = await open(page, app.id, "checks");
  await expect(
    checks.dialog.getByText("Within the US lending footprint.", { exact: true }),
  ).toBeVisible();
  await checks.dialog
    .getByRole("button", { name: "Close geographic eligibility", exact: true })
    .click();
  await expect(checks.trigger).toBeFocused();
  for (const name of ["Submission readiness", "Approval readiness", "Closing readiness"])
    await expect(page.getByRole("region", { name, exact: true })).not.toContainText(
      "Loan Footprint",
    );
  expect(external).toEqual([]);
});

test("unregistered US address stays eligible without a pin and changed non-US address replaces the result", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const app = await draft(page, { ...registeredAddress, line1: "987 Unregistered Demo Lane" });
  const { dialog } = await open(page, app.id);
  await expect(dialog.getByText("Within the US lending footprint.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog).toContainText("Map location unavailable");
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await workflowApi(page, "PATCH", `/applications/${app.id}/setup`, {
    definitionVersion: 2,
    expectedRevision: app.revision,
    currentStep: "business_address",
    answers: {
      businessAddress: {
        line1: "42 Synthetic Road",
        locality: "Toronto",
        region: "ON",
        postalCode: "M5V 2T6",
        countryCode: "CA",
      },
    },
  });
  const changed = await open(page, app.id);
  await expect(
    changed.dialog.getByText("Outside the US lending footprint.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(changed.dialog).toContainText("42 Synthetic Road");
  await expect(changed.dialog.locator("dl")).not.toContainText("987 Unregistered Demo Lane");
  await expect(changed.dialog.getByRole("img")).toHaveCount(0);
  await expect(
    changed.dialog.getByRole("button", { name: "Close geographic eligibility", exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
  await changed.dialog.screenshot({ path: testInfo.outputPath("synthetic-footprint-outside.png") });
});

test("missing address remains informational and the dialog preserves focus", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const app = await draft(page);
  const { dialog, trigger } = await open(page, app.id, "checks");
  await expect(dialog.getByText("Needs address.", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("Within the US lending footprint");
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await noOverflow(page);
  await dialog.screenshot({ path: testInfo.outputPath("synthetic-footprint-missing.png") });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("queued running failed and stale runs never display the old green result or pin", async ({
  page,
}) => {
  await signIn(page);
  const app = await draft(page, registeredAddress);
  await open(page, app.id);
  await expect(
    page.getByRole("dialog").getByText("Within the US lending footprint.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const saved = await workflowApi<ChecksView>(page, "GET", `/applications/${app.id}/checks`);
  const footprint = saved.checks.find((check) => check.kind === "loan_footprint");
  if (!footprint?.currentRunId) throw new Error("Expected a current synthetic footprint run.");
  const pattern = new RegExp(`/applications/${app.id}/checks$`);
  // Deliberately retain successful evidence while changing transport state to exercise
  // defensive display rules; the database tests separately prove stale-worker fencing.
  for (const state of ["queued", "running", "failed", "stale"] as const) {
    await page.route(pattern, async (route) => {
      const body = structuredClone(saved);
      const check = body.checks.find((check) => check.kind === "loan_footprint");
      if (!check) throw new Error("Missing synthetic footprint.");
      for (const run of check.runs) {
        run.status = state === "stale" ? "succeeded" : state;
        run.stale = state === "stale";
      }
      check.passes = false;
      check.canRefresh = false;
      await route.fulfill({ json: body });
    });
    const { dialog } = await open(page, app.id, "checks");
    await expect(dialog).not.toContainText("Within the US lending footprint");
    await expect(dialog.getByRole("img")).toHaveCount(0);
    await page.unroute(pattern);
  }
});

test("map failure preserves the country result and asynchronous refresh recovers with safe read failures", async ({
  page,
}) => {
  await signIn(page);
  const app = await draft(page, registeredAddress);
  const { dialog } = await open(page, app.id, "checks");
  await expect(dialog.getByText("Within the US lending footprint.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByRole("img")).toBeVisible();
  // Vite can inline this small bundled asset; use broken local bytes to exercise
  // the browser's actual image error event without adding any network provider.
  await dialog.locator("img").evaluate((img) => {
    img.src = "data:image/svg+xml,invalid";
  });
  await expect(dialog).toContainText("The bundled illustration could not load.");
  await expect(dialog.getByRole("img")).toHaveCount(0);
  const before = await workflowApi<ChecksView>(page, "GET", `/applications/${app.id}/checks`);
  const old = before.checks.find((check) => check.kind === "loan_footprint")?.currentRunId;
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith("/refresh") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Refresh Loan Footprint", exact: true }).click();
  const response = await refreshed;
  expect(response.ok()).toBe(true);
  const next = (await response.json()) as ChecksView;
  expect(next.checks.find((check) => check.kind === "loan_footprint")?.currentRunId).not.toBe(old);
  await expect(dialog.getByText("Within the US lending footprint.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText(/^Previous footprint runs/)).toBeVisible();
  const pattern = new RegExp(`/applications/${app.id}/checks$`);
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Synthetic read interruption.",
          requestId: randomUUID(),
        },
      },
    }),
  );
  await dialog.getByRole("button", { name: "Reload status", exact: true }).click();
  await expect(dialog.getByText("Status unavailable.", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("Within the US lending footprint");
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await page.unroute(pattern);
  await dialog.getByRole("button", { name: "Reload status", exact: true }).click();
  await expect(dialog.getByText("Within the US lending footprint.", { exact: true })).toBeVisible();
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: "NOT_FOUND", message: "Synthetic access revoked.", requestId: randomUUID() },
      },
    }),
  );
  await dialog.getByRole("button", { name: "Reload status", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("img", { name: /registered fixture pin/ })).toHaveCount(0);
});
