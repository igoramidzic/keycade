import type { BrowserContext } from "@playwright/test";

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
