import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("idle borrower overview avoids session fan-out and three-second background polling", async ({
  page,
}) => {
  await page.goto(borrower);
  await fillSignInEmail(page, "borrower@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.clock.install();
  const requests = new Map<string, number>();
  // React development StrictMode starts and aborts an extra mount fetch. Count completed reads.
  page.on("response", (response) => {
    if (!response.ok()) return;
    const path = new URL(response.url()).pathname;
    const resource =
      path === "/api/v1/auth/session"
        ? "session"
        : path.match(
            new RegExp(`/applications/${applicationId}/(tasks|documents|readiness|review)$`),
          )?.[1];
    if (resource) requests.set(resource, (requests.get(resource) ?? 0) + 1);
  });
  const loaded = Promise.all(
    ["tasks", "documents", "readiness"].map((resource) =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(`/applications/${applicationId}/${resource}`) &&
          response.ok(),
      ),
    ),
  );
  await page.goto(`${borrower}/applications/${applicationId}?bank=bank-a`);
  await loaded;
  await expect(
    page.getByRole("button", { name: "Describe your business", exact: true }),
  ).toBeVisible();
  expect(requests.get("session")).toBe(1);
  expect(requests.get("tasks")).toBe(1);
  expect(requests.get("documents")).toBe(1);
  expect(requests.get("readiness")).toBe(1);
  expect(requests.get("review") ?? 0).toBe(0);
  const initial = [...requests];
  await page.clock.runFor(12_001);
  expect([...requests]).toEqual(initial);
});

const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;

async function staffQueue(page: import("@playwright/test").Page) {
  await page.goto(staff);
  await fillSignInEmail(page, "officer-a@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Cedar Workshop", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Funded accounts", exact: true })).toBeVisible();
}

test("staff focus checks and account refresh keep the queue visible and preserve input", async ({
  page,
}) => {
  await staffQueue(page);
  await page.clock.install();
  await page.getByLabel("Search applications", { exact: true }).fill("Unsaved search");
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sessionRequests = 0;
  let optionsRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/staff/options")) optionsRequests++;
  });
  await page.route("**/api/v1/auth/session", async (route) => {
    sessionRequests++;
    await pending;
    await route.continue();
  });
  await page.route(/\/api\/v1\/banks\/[^/]+\/accounts$/, async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.clock.runFor(30_001);
    // Browser focus and visibility notifications can arrive in the same turn.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(() => sessionRequests).toBe(1);
    await expect(
      page.getByRole("link", { name: "Cedar Workshop", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Funded accounts", exact: true })).toBeVisible();
    await expect(page.getByLabel("Search applications", { exact: true })).toHaveValue(
      "Unsaved search",
    );
    await expect(page.getByText("Checking staff access…", { exact: true })).toHaveCount(0);
    expect(sessionRequests).toBe(1);
    expect(optionsRequests).toBe(0);
  } finally {
    release();
  }
});

test("staff focus recheck hides protected content after another tab signs out", async ({
  page,
  context,
}) => {
  await staffQueue(page);
  const session = await context.request.get(`${staff}/api/v1/auth/session`);
  const current = await session.json();
  const logout = await context.request.post(`${staff}/api/v1/auth/logout`, {
    headers: { Origin: staff, "x-csrf-token": current.csrfToken },
    data: {},
  });
  expect(logout.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Cedar Workshop", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
