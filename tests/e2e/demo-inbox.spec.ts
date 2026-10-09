import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { paceHostedRequests } from "./hosted-helpers";
import { fillSignInEmail, messages, requestAccessEmail } from "./identity-helpers";
import { completeAddressAndSkipOptional } from "./setup-helpers";

const env = readEnvironment();
const borrower = env.KEYCADE_E2E_BORROWER_ORIGIN ?? `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = env.KEYCADE_E2E_STAFF_ORIGIN ?? `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const hosted = env.KEYCADE_E2E_HOSTED === "true";

// Confirmation credentials stay inside the browser; never retain auth/network artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(hosted ? 180_000 : 75_000);
test.skip(env.DEMO_INBOX_ENABLED !== "true", "Private simulated inbox delivery is opt-in locally.");
test.beforeEach(async ({ context }) => {
  if (hosted) await paceHostedRequests(context);
});

async function requestEmail(page: Page, email: string, action = "Send sign-in link") {
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await requestAccessEmail(page, email, action === "Start application");
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/?bank=bank-a`);
  await fillSignInEmail(page, email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function openInbox(page: Page) {
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
}
async function selectReadyMessage(page: Page, subject: string) {
  const item = page
    .getByRole("list", { name: "Messages" })
    .getByRole("button")
    .filter({ hasText: subject })
    .filter({ hasText: "Ready" })
    .first();
  await expect(item).toBeVisible({ timeout: 25_000 });
  await item.click();
  const detail = page.getByRole("region", { name: "Selected message" });
  await expect(detail.getByText(/No external email has been sent\./)).toHaveCount(0);
  // Boolean checks cannot print an accidentally rendered credential in the report.
  expect(await detail.evaluate((node) => !/#token=[a-f0-9]{64}/.test(node.textContent ?? ""))).toBe(
    true,
  );
  return detail;
}
async function openConfirmation(page: Page) {
  try {
    await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
  } catch {
    // Navigation failures may include a URL; keep bearer values out of test diagnostics.
    throw new Error("Could not open the synthetic inbox confirmation.");
  }
  await expect(page.getByText("Confirm your sign-in", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash === "")).toBe(true);
}
async function authenticationMethod(page: Page) {
  return page.evaluate(async () => {
    const session = await (await fetch("/api/v1/auth/session")).json();
    return session.authenticated ? session.authenticationMethod : "anonymous";
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("borrower inbox requires deliberate confirmation, conceals the used link, and stays available after logout", async ({
  page,
}) => {
  const email = `synthetic-inbox-browser-${randomUUID()}@example.test`;
  let consumptions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/auth/consume")
      consumptions++;
  });
  await page.goto(borrower);
  await requestEmail(page, email);
  await openInbox(page);
  await selectReadyMessage(page, "Your Keycade sign-in link");
  expect(await authenticationMethod(page)).toBe("demo");
  expect(consumptions).toBe(0);
  await noOverflow(page);
  await openConfirmation(page);
  expect(consumptions).toBe(0);
  expect(await authenticationMethod(page)).toBe("demo");
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  expect(consumptions).toBe(1);
  expect(await authenticationMethod(page)).toBe("email_link");
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const used = page
    .getByRole("list", { name: "Messages" })
    .getByRole("button")
    .filter({ hasText: "Your Keycade sign-in link" });
  await expect(used).toContainText("Used");
  await used.click();
  const detail = page.getByRole("region", { name: "Selected message" });
  await expect(
    detail.getByText("This confirmation link is no longer available.", { exact: false }),
  ).toBeVisible();
  await expect(detail.getByRole("button", { name: "Open confirmation", exact: true })).toHaveCount(
    0,
  );
  expect(await detail.evaluate((node) => !/#token=[a-f0-9]{64}/.test(node.textContent ?? ""))).toBe(
    true,
  );
  await page.reload();
  await expect(page.getByRole("list", { name: "Messages" })).toContainText("Used");
  if (!hosted)
    expect(
      (await messages()).filter((message) => message.To.some((to) => to.Address === email)),
    ).toHaveLength(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // Do not reload: logout must preserve the feature flag needed by the next request.
  await requestEmail(page, email);
  await expect(page.getByRole("button", { name: "Open inbox", exact: true })).toBeVisible();
});

test("email-started application resumes its saved setup through a fresh simulated inbox link", async ({
  page,
  context,
}) => {
  const email = `synthetic-inbox-resume-${randomUUID()}@example.test`;
  let starts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/applications/start"
    )
      starts++;
  });
  await page.goto(`${borrower}/apply?bank=bank-a`);
  await requestEmail(page, email, "Start application");
  await openInbox(page);
  await selectReadyMessage(page, "Your application is started");
  await openConfirmation(page);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByLabel("Legal business name", { exact: true })).toBeVisible();
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  expect(Boolean(applicationId)).toBe(true);
  await page.getByLabel("Legal business name", { exact: true }).fill("Synthetic Inbox Workshop");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await completeAddressAndSkipOptional(page);
  await page.getByLabel("Requested amount", { exact: true }).fill("23000");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();
  await context.clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(borrower);
  await requestEmail(page, email);
  await openInbox(page);
  await selectReadyMessage(page, "Your Keycade sign-in link");
  await openConfirmation(page);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(
    /23,?000(?:\.00)?/,
  );
  expect(new URL(page.url()).pathname).toBe(`/applications/${applicationId}/setup/amount`);
  expect(starts).toBe(1);
  await noOverflow(page);
  if (!hosted)
    expect(
      (await messages()).filter((message) => message.To.some((to) => to.Address === email)),
    ).toHaveLength(0);
});

test("known synthetic staff confirms through its own demo inbox", async ({ page }) => {
  await page.goto(staff);
  await requestEmail(page, "officer-a@example.test");
  await openInbox(page);
  await selectReadyMessage(page, "Your Keycade sign-in link");
  expect(await authenticationMethod(page)).toBe("demo");
  await noOverflow(page);
  await openConfirmation(page);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  expect(await authenticationMethod(page)).toBe("email_link");
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(200);
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const used = page
    .getByRole("list", { name: "Messages" })
    .getByRole("button")
    .filter({ hasText: "Your Keycade sign-in link" })
    .first();
  await expect(used).toContainText("Used");
  await used.click();
  await expect(
    page
      .getByRole("region", { name: "Selected message" })
      .getByText("This confirmation link is no longer available.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open confirmation", exact: true })).toHaveCount(0);
});

test("unknown staff cannot open a demo inbox or acquire bank membership", async ({ page }) => {
  const email = `synthetic-inbox-nonstaff-${randomUUID()}@example.test`;
  await page.goto(staff);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await requestAccessEmail(page, email);
  const status = await page.evaluate(
    async (email) =>
      (
        await fetch("/api/v1/auth/demo-sign-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, bankSlug: "bank-a", portal: "staff" }),
        })
      ).status,
    email,
  );
  expect(status).toBe(404);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toHaveCount(0);
  expect(await authenticationMethod(page)).toBe("anonymous");
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(404);
  if (!hosted)
    expect(
      (await messages()).filter((message) => message.To.some((to) => to.Address === email)),
    ).toHaveLength(0);
});
