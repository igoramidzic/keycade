import { type BrowserContext, expect, type Page } from "@playwright/test";

let nextRequestAt = 0;
/** Pace all test identities together below the hosted API's per-IP request budget. */
export async function paceHostedRequests(context: BrowserContext) {
  await context.route("**/api/**", async (route) => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(nextRequestAt, Date.now()) + 850;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      await route.continue();
    } catch {
      // A test may close its context while a queued background poll is waiting.
    }
  });
}

/** Confirm a message through its intended identity's UI without exposing the bearer to Node. */
export async function confirmHostedInboxMessage(page: Page, subject: string) {
  const message = page
    .getByRole("list", { name: "Simulated messages" })
    .getByRole("button")
    .filter({ hasText: subject })
    .filter({ hasText: "Ready" })
    .first();
  await expect(message).toBeVisible({ timeout: 120_000 });
  await message.click();
  const detail = page.getByRole("region", { name: "Selected simulated message" });
  await expect(detail).toBeVisible();
  expect(await detail.evaluate((node) => !/#token=[a-f0-9]{64}/.test(node.textContent ?? ""))).toBe(
    true,
  );
  try {
    await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
  } catch {
    throw new Error("Could not open the hosted simulated confirmation.");
  }
  await expect(page.getByText("Confirm your sign-in", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash === "")).toBe(true);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
}
