import { readEnvironment } from "@keycade/config/server";
import { expect, type Page } from "@playwright/test";

const env = readEnvironment();
const inbox = `http://127.0.0.1:${env.MAILPIT_UI_PORT ?? 8025}`;

type InboxMessage = { ID: string; To: { Address: string }[] };

export async function fillSignInEmail(page: Page, email: string) {
  const field = page.getByLabel("Email address", { exact: true });
  await expect(field).toBeVisible();
  if (await field.evaluate((element) => element.tagName === "SELECT"))
    await field.selectOption(email);
  else await field.fill(email);
}

// Email confirmations still support invitations and recovery. Their fixture setup no longer
// depends on a sign-in method switch in the product UI.
export async function requestAccessEmail(page: Page, email: string, start = false) {
  const staff = await page
    .getByRole("combobox", { name: "Email address", exact: true })
    .isVisible();
  const status = await page.evaluate(
    async ({ email, start, staff }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const bankSlug = new URLSearchParams(location.search).get("bank") ?? "bank-a";
      const returnPath =
        /^\/(?:invitations|signatures|applications)\/[0-9a-f-]{36}(?:\/setup)?$/.test(
          location.pathname,
        )
          ? location.pathname
          : "/";
      return (
        await fetch(start ? "/api/v1/applications/start" : "/api/v1/auth/request-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session.authenticated ? { "x-csrf-token": session.csrfToken } : {}),
          },
          body: JSON.stringify(
            start
              ? {
                  email,
                  bankSlug,
                  idempotencyKey:
                    crypto.randomUUID().replaceAll("-", "") +
                    crypto.randomUUID().replaceAll("-", ""),
                }
              : { email, bankSlug, portal: staff ? "staff" : "borrower", returnPath },
          ),
        })
      ).status;
    },
    { email, start, staff },
  );
  expect(status).toBe(202);
}

export async function messages(): Promise<InboxMessage[]> {
  const response = await fetch(`${inbox}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error("Local inbox is unavailable.");
  const result = (await response.json()) as { messages: InboxMessage[] };
  return result.messages;
}

export async function requestLink(page: Page, origin: string, email: string) {
  const previous = new Set((await messages()).map((message) => message.ID));
  await page.goto(origin);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await requestAccessEmail(page, email);
  return waitForLink(origin, email, previous);
}

export async function waitForLink(origin: string, email: string, previous: Set<string>) {
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

export async function openLink(page: Page, link: string) {
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
