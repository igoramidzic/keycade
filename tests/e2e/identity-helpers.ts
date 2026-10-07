import { readEnvironment } from "@keycade/config/server";
import { expect, type Page } from "@playwright/test";

const env = readEnvironment();
const inbox = `http://127.0.0.1:${env.MAILPIT_UI_PORT ?? 8025}`;

type InboxMessage = { ID: string; To: { Address: string }[] };

export async function messages(): Promise<InboxMessage[]> {
  const response = await fetch(`${inbox}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error("Local inbox is unavailable.");
  const result = (await response.json()) as { messages: InboxMessage[] };
  return result.messages;
}

export async function requestLink(page: Page, origin: string, email: string) {
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
