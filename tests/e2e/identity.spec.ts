import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, type Response, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const inbox = `http://127.0.0.1:${env.MAILPIT_UI_PORT ?? 8025}`;

// Mailpit necessarily contains bearer links. Never retain network traces, screenshots,
// videos, or assertions that print link values for this journey.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

type InboxMessage = { ID: string; To: { Address: string }[] };

async function messages(): Promise<InboxMessage[]> {
  const response = await fetch(`${inbox}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error("Local inbox is unavailable.");
  const result = (await response.json()) as { messages: InboxMessage[] };
  return result.messages;
}

async function requestLink(page: Page, origin: string, email: string) {
  const previous = new Set((await messages()).map((message) => message.ID));
  await page.goto(origin);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  const emailLinkOption = page.getByRole("button", {
    name: "Use an email link instead",
    exact: true,
  });
  if (await emailLinkOption.isVisible()) await emailLinkOption.click();
  await page.getByRole("button", { name: "Send sign-in link", exact: true }).click();
  await expect(page.getByText("Check your inbox", { exact: true })).toBeVisible();
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const message = (await messages()).find(
          (candidate) =>
            !previous.has(candidate.ID) && candidate.To.some((to) => to.Address === email),
        );
        if (!message) return false;
        const response = await fetch(`${inbox}/api/v1/message/${message.ID}`);
        if (!response.ok) return false;
        const body = (await response.json()) as { Text: string };
        const candidate = body.Text.split(/\s+/).find((word) =>
          word.startsWith(`${origin}/auth/confirm#token=`),
        );
        link = candidate ?? null;
        return link !== null;
      },
      { timeout: 25_000, message: "A synthetic sign-in email should reach the local inbox." },
    )
    .toBe(true);
  if (!link) throw new Error("Synthetic sign-in email had no confirmation link.");
  return link;
}

async function openLink(page: Page, link: string) {
  try {
    await page.goto(link);
  } catch {
    // Suppress errors from navigation which may include the original bearer URL.
    throw new Error("Could not open the synthetic sign-in confirmation page.");
  }
  await expect(page.getByText("Confirm your sign-in", { exact: true })).toBeVisible();
  // A boolean assertion cannot print the credential if fragment removal regresses.
  expect(await page.evaluate(() => window.location.hash === "")).toBe(true);
}

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
  await expect(
    page.getByText("You’re signed in to the bank console", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#identity").getByText("Demo access", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in to demo", exact: true })).toBeVisible();
  expect(emailsRequested).toBe(0);
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
  await expect(
    page.getByText("You’re signed in to the bank console", { exact: true }),
  ).toBeVisible();
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
