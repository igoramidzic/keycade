import { type BrowserContext, expect, type Page, type TestInfo } from "@playwright/test";

/** Keep transport diagnostics useful without retaining URLs, bodies, cookies or bearer links. */
export function recordHostedHttpFailures(
  context: BrowserContext,
  testInfo: TestInfo,
  actor: "borrower" | "staff" | "outsider",
) {
  const seen = new Set<string>();
  function normalizedApiPath(rawUrl: string) {
    const url = new URL(rawUrl);
    if (!url.pathname.startsWith("/api/")) return null;
    return url.pathname
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, ":id")
      .replace(/[a-f0-9]{32,}/gi, ":redacted")
      .split("/")
      .map((part) => (part.includes("@") || /%40/i.test(part) ? ":redacted" : part))
      .join("/");
  }
  function record(type: string, description: string) {
    if (seen.has(description) || seen.size >= 50) return;
    seen.add(description);
    testInfo.annotations.push({ type, description });
  }
  context.on("response", (response) => {
    if (response.status() < 400) return;
    const path = normalizedApiPath(response.url());
    if (!path) return;
    const description = `${actor}: ${response.status()} ${response.request().method()} ${path}`;
    record("hosted_http_failure", description);
  });
  context.on("requestfailed", (request) => {
    const path = normalizedApiPath(request.url());
    if (!path) return;
    const reason = /abort/i.test(request.failure()?.errorText ?? "") ? "aborted" : "other";
    record("hosted_request_failure", `${actor}: ${reason} ${request.method()} ${path}`);
  });
}

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
