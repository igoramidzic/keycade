import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Response, test } from "@playwright/test";
import { openLink, requestLink } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;

// Mailpit necessarily contains bearer links. Never retain network traces, screenshots,
// videos, or assertions that print link values for this journey.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("borrower demo sign-in opens immediately, persists, and logs out without an email", async ({
  page,
}) => {
  let emailsRequested = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/auth/request-link") emailsRequested += 1;
  });
  const email = `demo-browser-${randomUUID()}@example.test`;
  await page.goto(borrower);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByText("You’re signed in", { exact: true })).toBeVisible();
  await expect(page.locator("#identity").getByText("Demo access", { exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText("Email verified", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in to demo", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in to demo", exact: true })).toBeVisible();
  expect(emailsRequested).toBe(0);
});

test("staff demo sign-in enforces bank membership without an email", async ({ page }) => {
  let emailsRequested = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/auth/request-link") emailsRequested += 1;
  });
  const nonstaff = `demo-nonstaff-${randomUUID()}@example.test`;
  await page.goto(staff);
  await page.getByLabel("Email address", { exact: true }).fill(nonstaff);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("can’t access this staff demo");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(nonstaff);
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(404);
  await page.getByLabel("Email address", { exact: true }).fill("officer-a@example.test");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await expect(page.getByText("Demo access · email unverified", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in to demo", exact: true })).toBeVisible();
  expect(emailsRequested).toBe(0);
});

test("staff demo sign-in preserves email during a service outage and can retry", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/demo-sign-in", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable. Please try again in a moment.",
          requestId: randomUUID(),
        },
      },
    }),
  );
  await page.goto(staff);
  await page.getByLabel("Email address", { exact: true }).fill("officer-a@example.test");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in is temporarily unavailable. Please try again in a moment.",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "officer-a@example.test",
  );
  await page.unroute("**/api/v1/auth/demo-sign-in");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
});

test("borrower email confirmation is deliberate, resumes, revokes on logout, and rejects replay", async ({
  page,
}) => {
  const email = `borrower-browser-${randomUUID()}@example.test`;
  const link = await requestLink(page, borrower, email);
  let consumptions = 0;
  let additionalLinkRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/consume") consumptions += 1;
    if (path === "/api/v1/auth/request-link") additionalLinkRequests += 1;
  });
  await openLink(page, link);
  expect(consumptions).toBe(0);

  // The credential is already consumed when this read fails. Retry must restore the
  // session from its cookie without consuming again or requesting another email.
  let failSessionRead = false;
  const armSessionFailure = (response: Response) => {
    if (new URL(response.url()).pathname === "/api/v1/auth/consume" && response.status() === 200)
      failSessionRead = true;
  };
  page.on("response", armSessionFailure);
  await page.route("**/api/v1/auth/session", (route) => {
    if (!failSessionRead) return route.continue();
    failSessionRead = false;
    return route.fulfill({ status: 503, json: { error: "Session temporarily unavailable" } });
  });
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByText("Sign-in is temporarily unavailable", { exact: true })).toBeVisible();
  page.off("response", armSessionFailure);
  await page.unroute("**/api/v1/auth/session");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("You’re signed in", { exact: true })).toBeVisible();
  expect(consumptions).toBe(1);
  expect(additionalLinkRequests).toBe(0);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await openLink(page, link);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByText("This link can’t be used", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request a new link", exact: true }).click();
  const freshLink = await requestLink(page, borrower, email);
  await openLink(page, freshLink);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByText("You’re signed in", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
});

test("staff membership permits the seeded officer and denies an unrecognized address", async ({
  page,
}, testInfo) => {
  // The one seeded officer mailbox must not be consumed concurrently by two projects.
  // Both viewports still exercise the full borrower journey and the staff shell.
  test.skip(testInfo.project.name !== "desktop", "Seeded staff identity runs once on desktop.");
  const deniedEmail = `nonstaff-browser-${randomUUID()}@example.test`;
  const deniedLink = await requestLink(page, staff, deniedEmail);
  await openLink(page, deniedLink);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByText("This link can’t be used", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(404);
  const link = await requestLink(page, staff, "officer-a@example.test");
  await openLink(page, link);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  await expect(page.getByText("officer-a@example.test", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
});

test("sign-in preserves email on a failed request and recovers from a missing link", async ({
  page,
}) => {
  await page.goto(`${borrower}/auth/confirm`);
  await expect(page.getByText("This link can’t be used", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request a new link", exact: true }).click();
  await page.route("**/api/v1/auth/request-link", (route) => route.abort());
  await page.getByLabel("Email address", { exact: true }).fill("retry@example.test");
  await page.getByRole("button", { name: "Send sign-in link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("please try again");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("retry@example.test");
});
