import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { messages, openLink, requestLink, waitForLink } from "./identity-helpers";

const env = readEnvironment();
const bank = `http://127.0.0.1:${env.BANK_SITE_PORT ?? 3000}`;
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const apply = `${borrower}/apply?bank=bank-a`;

// These journeys carry session credentials and, for email access, one-time bearer links.
// Keep browser/network artifacts out of test reports, including on failure.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(75_000);

type Setup = {
  id: string;
  bankId: string;
  businessName: string | null;
  requestedAmount: string | null;
  purpose: string | null;
  productId: string | null;
  revision: number;
  currentStep: string;
  setupStatus: string;
  status: string;
  skippedSteps: string[];
};

async function api<T>(page: Page, method: string, suffix: string, body?: object): Promise<T> {
  // Session/CSRF data remains in the browser. Only safe domain responses leave this helper.
  return page.evaluate(
    async ({ method, suffix, body }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      if (!session.authenticated) throw new Error("Expected an authenticated synthetic fixture.");
      const response = await fetch(`/api/v1/banks/${session.bank.id}/applications${suffix}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error(`Synthetic application fixture failed (${response.status}).`);
      return response.json();
    },
    { method, suffix, body },
  );
}

async function setup(page: Page): Promise<Setup> {
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  if (!applicationId) throw new Error("Expected an application setup route.");
  return api<Setup>(page, "GET", `/${applicationId}/setup`);
}

async function demoSignIn(page: Page, email: string) {
  await page.goto(borrower);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
}

async function answer(page: Page, label: string, value: string, nextLabel: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel(nextLabel, { exact: true })).toBeVisible();
}

async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("bank apply, saved edits, browser loss, and explicit completion use the same application", async ({
  page,
  context,
}) => {
  const email = `intake-demo-${randomUUID()}@example.test`;
  let creations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/v1\/banks\/[^/]+\/applications$/.test(new URL(request.url()).pathname)
    )
      creations += 1;
  });
  await page.goto(bank);
  await page.getByRole("link", { name: "Apply for business financing", exact: true }).click();
  await expect(page).toHaveURL(apply);
  await expect(page.getByText("Synthetic Bank A", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  const original = await setup(page);
  expect(original).toMatchObject({ currentStep: "business_name", setupStatus: "in_progress" });
  expect(creations).toBe(1);
  await expect(
    page.getByRole("progressbar", { name: "Setup progress", exact: true }),
  ).toHaveAttribute("value", "1");
  await assertNoOverflow(page);

  // One question is shown, and keyboard navigation reaches the next action.
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveCount(0);
  await page.getByLabel("Business name", { exact: true }).fill("Synthetic Pine Workshop");
  await page.getByLabel("Business name", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Requested amount", { exact: true })).toBeVisible();
  await page.getByLabel("Requested amount", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await setup(page)).requestedAmount).toBeNull();
  await expect(
    page.getByRole("progressbar", { name: "Setup progress", exact: true }),
  ).toHaveAttribute("value", "2");
  await answer(page, "Requested amount", "25000", "Loan purpose");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(
    /25,?000(?:\.00)?/,
  );
  await answer(page, "Requested amount", "50000", "Loan purpose");
  await page.getByLabel("Loan purpose", { exact: true }).fill("Synthetic workshop equipment");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await context.clearCookies();
  await demoSignIn(page, email);
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Loan purpose", { exact: true })).toHaveValue(
    "Synthetic workshop equipment",
  );
  expect(await setup(page)).toMatchObject({
    id: original.id,
    businessName: "Synthetic Pine Workshop",
    requestedAmount: "50000.00",
    currentStep: "purpose",
    setupStatus: "in_progress",
  });
  expect(creations).toBe(1);

  await page.goto(`${borrower}/applications/${original.id}`);
  await expect(page).toHaveURL(`${borrower}/applications/${original.id}/setup?bank=bank-a`);
  await expect(page.getByLabel("Loan purpose", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Industry", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your application setup", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic Pine Workshop", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit .*product/i })).toHaveCount(0);
  const reviewed = await setup(page);
  expect(reviewed).toMatchObject({ setupStatus: "in_progress", status: "draft" });
  expect(reviewed.skippedSteps).toContain("industry");
  await assertNoOverflow(page);

  // A failed completion must neither move the route nor unlock backend state.
  await page.route("**/setup/finish", (route) => route.abort());
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await setup(page)).setupStatus).toBe("in_progress");
  await page.unroute("**/setup/finish");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${borrower}/applications/${original.id}?bank=bank-a`);
  expect(await api<Setup>(page, "GET", `/${original.id}/setup`)).toMatchObject({
    setupStatus: "completed",
    status: "collecting_information",
  });
  await page.reload();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  await context.clearCookies();
  await demoSignIn(page, email);
  await page.getByRole("button", { name: "Open application", exact: true }).click();
  await expect(page).toHaveURL(`${borrower}/applications/${original.id}?bank=bank-a`);
  expect(creations).toBe(1);
});

test("failed saves retain edits and stale revisions require an explicit recoverable retry", async ({
  page,
}) => {
  const email = `intake-retry-${randomUUID()}@example.test`;
  let loseCreationResponse = true;
  const creationKeys: string[] = [];
  await page.route("**/api/v1/banks/*/applications", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creationKeys.push(route.request().postDataJSON().idempotencyKey);
    if (!loseCreationResponse) return route.continue();
    loseCreationResponse = false;
    await route.fetch(); // Persist the draft, then simulate losing its acknowledgment.
    return route.abort();
  });
  await page.goto(`${borrower}/apply?bank=bank-a`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  expect(creationKeys).toHaveLength(2);
  expect(new Set(creationKeys).size).toBe(1);
  expect((await api<{ items: Setup[] }>(page, "GET", "")).items).toHaveLength(1);
  await page.unroute("**/api/v1/banks/*/applications");
  const original = await setup(page);
  await page.getByLabel("Business name", { exact: true }).fill("Synthetic unsaved name");
  await page.route("**/applications/*/setup", (route) =>
    route.request().method() === "PATCH" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Synthetic unsaved name",
  );
  expect(await setup(page)).toMatchObject({
    revision: original.revision,
    businessName: null,
    currentStep: "business_name",
  });
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Synthetic unsaved name",
  );
  await page.unroute("**/applications/*/setup");

  // Another device saves while the current browser still holds the original revision.
  await api(page, "PATCH", `/${original.id}/setup`, {
    expectedRevision: original.revision,
    answers: { businessName: "Synthetic other-device name" },
    step: "business_name",
    currentStep: "business_name",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review latest saved version", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Synthetic unsaved name",
  );
  await page.getByRole("button", { name: "Review latest saved version", exact: true }).click();
  await expect(page.getByText("Synthetic other-device name", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Synthetic unsaved name",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toBeVisible();
  expect(await setup(page)).toMatchObject({
    businessName: "Synthetic unsaved name",
    currentStep: "amount",
  });
  await expect(page.getByRole("button", { name: /Change .*product/i })).toHaveCount(0);
  await expect(page.getByLabel("Financial Product", { exact: true })).toHaveCount(0);
  await page.getByLabel("Requested amount", { exact: true }).fill("42000");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("42000.00");
});

test("email start, expired-link recovery, and fresh links resume the same draft after storage loss", async ({
  page,
  context,
}) => {
  const email = `intake-email-${randomUUID()}@example.test`;
  const previous = new Set((await messages()).map((message) => message.ID));
  let starts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/applications/start") starts += 1;
  });
  await page.goto(apply);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Use an email link instead", exact: true }).click();
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(page.getByText("Check your inbox", { exact: true })).toBeVisible();
  const originalLink = await waitForLink(borrower, email, previous);
  await openLink(page, originalLink);
  // Deterministically exercise expiry presentation; identity integration tests verify
  // actual clock-based expiry. No draft is claimed until a fresh real link succeeds.
  await page.route("**/api/v1/auth/consume", (route) =>
    route.fulfill({
      status: 410,
      json: { error: { code: "INVALID_LINK", message: "Link expired." } },
    }),
  );
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByText("This link can’t be used", { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/auth/consume");
  const firstFreshLink = await requestLink(page, borrower, email);
  await openLink(page, firstFreshLink);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  const original = await setup(page);
  await answer(page, "Business name", "Synthetic Email Workshop", "Requested amount");
  await page.getByLabel("Requested amount", { exact: true }).fill("10000");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await context.clearCookies();
  await openLink(page, firstFreshLink);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByText("This link can’t be used", { exact: true })).toBeVisible();
  const freshLink = await requestLink(page, borrower, email);
  await openLink(page, freshLink);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(
    /10,?000(?:\.00)?/,
  );
  expect(await setup(page)).toMatchObject({
    id: original.id,
    businessName: "Synthetic Email Workshop",
    requestedAmount: "10000.00",
    currentStep: "amount",
  });
  expect(starts).toBe(1);
});

test("a staff-prefilled draft requires the applicant to review and explicitly finish setup", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Seeded staff identity fixture runs once.");
  const email = `intake-staff-prefill-${randomUUID()}@example.test`;
  await page.goto(staff);
  await page.getByLabel("Email address", { exact: true }).fill("officer-a@example.test");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  const draft = await api<Setup>(page, "POST", "", { email, idempotencyKey: randomUUID() });
  const catalog = await page.evaluate(async () =>
    (await fetch("/api/v1/public/banks/bank-a/intake")).json(),
  );
  const productId = catalog.products[0]?.id;
  if (!productId) throw new Error("Expected an available synthetic financing product.");
  await api(page, "PATCH", `/${draft.id}/setup`, {
    expectedRevision: draft.revision,
    answers: {
      businessName: "Synthetic Staff Prefill",
      productId,
      requestedAmount: "10000.00",
      purpose: "Synthetic equipment",
    },
    currentStep: "review",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await demoSignIn(page, email);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your application setup", exact: true }),
  ).toBeVisible();
  expect((await setup(page)).setupStatus).toBe("in_progress");
  await page.goto(`${borrower}/applications/${draft.id}`);
  await expect(page).toHaveURL(`${borrower}/applications/${draft.id}/setup?bank=bank-a`);
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
});

test("session recovery keeps unsaved answers and another signed-in account cannot submit stale forms", async ({
  page,
  context,
  browser,
}) => {
  const email = `intake-session-${randomUUID()}@example.test`;
  await page.goto(apply);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  await answer(page, "Business name", "Synthetic Session Workshop", "Requested amount");
  const saved = await setup(page);
  await page.getByLabel("Requested amount", { exact: true }).fill("37500");

  await page.route("**/api/v1/auth/logout", (route) => route.abort());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("sign you out");
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("37500");
  await page.unroute("**/api/v1/auth/logout");
  expect(
    await page.evaluate(async () => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      return (
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
          body: "{}",
        })
      ).ok;
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("37500");
  await page.getByRole("button", { name: "Sign in again", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("37500");
  expect((await setup(page)).requestedAmount).toBeNull();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Loan purpose", { exact: true })).toBeVisible();
  await page.getByLabel("Loan purpose", { exact: true }).fill("Synthetic unsaved purpose");

  // A fresh device has no access to this tab's recovery memory and resumes server data.
  const otherDevice = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const otherDevicePage = await otherDevice.newPage();
    await demoSignIn(otherDevicePage, email);
    await expect(
      otherDevicePage.getByRole("button", { name: "Continue setup", exact: true }),
    ).toHaveCount(1);
    await otherDevicePage.getByRole("button", { name: "Continue setup", exact: true }).click();
    await expect(otherDevicePage.getByLabel("Loan purpose", { exact: true })).toHaveValue("");
    expect(await setup(otherDevicePage)).toMatchObject({
      id: saved.id,
      businessName: "Synthetic Session Workshop",
      requestedAmount: "37500.00",
      purpose: null,
      currentStep: "purpose",
    });
  } finally {
    await otherDevice.close();
  }

  const startPage = await context.newPage();
  await startPage.goto(apply);
  await expect(startPage.getByText("Start a new application", { exact: true })).toBeVisible();
  let staleMutations = 0;
  for (const stalePage of [page, startPage]) {
    stalePage.on("request", (request) => {
      if (
        ["POST", "PATCH"].includes(request.method()) &&
        /\/api\/v1\/banks\/[^/]+\/applications(?:\/|$)/.test(new URL(request.url()).pathname)
      )
        staleMutations += 1;
    });
  }
  expect(
    await startPage.evaluate(async (otherEmail) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      return (
        await fetch("/api/v1/auth/demo-sign-in", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
          body: JSON.stringify({
            email: otherEmail,
            bankSlug: "bank-a",
            portal: "borrower",
            returnPath: "/",
          }),
        })
      ).ok;
    }, `intake-other-account-${randomUUID()}@example.test`),
  ).toBe(true);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your sign-in changed" })).toBeVisible();
  await expect(page.getByLabel("Loan purpose", { exact: true })).toHaveValue(
    "Synthetic unsaved purpose",
  );
  await startPage.getByRole("button", { name: "Start application", exact: true }).click();
  await expect(startPage.getByRole("alert")).toContainText("Your sign-in changed");
  expect(staleMutations).toBe(0);
  await startPage.close();
});
