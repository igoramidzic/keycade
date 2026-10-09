import { readEnvironment } from "@keycade/config/server";
import { expect, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
test.use({ trace: "off", screenshot: "off", video: "off" });

for (const portal of ["staff", "borrower"] as const) {
  const origin = `http://127.0.0.1:${portal === "staff" ? (env.BANK_CONSOLE_PORT ?? 3002) : (env.BORROWER_PORT ?? 3001)}`;
  const email = portal === "staff" ? "officer-a@example.test" : "borrower@example.test";
  const heading = portal === "staff" ? "Applications" : "Your applications";
  const cardId = portal === "staff" ? "identity" : "sign-in";

  test(`${portal} reload shows neither sign-in nor private content until access is verified`, async ({
    page,
  }) => {
    await page.goto(origin);
    await fillSignInEmail(page, email);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    let releaseSession = () => {};
    let releaseStaff = () => {};
    const pendingSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const pendingStaff = new Promise<void>((resolve) => {
      releaseStaff = resolve;
    });
    let staffProofStarted = false;
    await page.route("**/api/v1/auth/session", async (route) => {
      await pendingSession;
      await route.continue();
    });
    if (portal === "staff") {
      await page.route("**/api/v1/auth/staff", async (route) => {
        staffProofStarted = true;
        await pendingStaff;
        await route.continue();
      });
    }
    const neutral = async () => {
      await expect(page.getByRole("status").filter({ hasText: "Checking access…" })).toBeVisible();
      await expect(page.locator(`#${cardId}`)).toHaveCount(0);
      await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
      await expect(
        page.getByText("Every application, clearly laid out.", { exact: true }),
      ).toHaveCount(0);
    };
    try {
      await page.reload();
      await neutral();
      releaseSession();
      if (portal === "staff") {
        await expect.poll(() => staffProofStarted).toBe(true);
        await neutral();
      }
    } finally {
      releaseSession();
      releaseStaff();
    }
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  });

  test(`${portal} uncertain or failed session checks do not show a login form`, async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/session", (route) =>
      route.fulfill({ status: 503, json: { error: "Unavailable" } }),
    );
    await page.goto(origin);
    await expect(
      page.getByText("Sign-in is temporarily unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
    await page.unroute("**/api/v1/auth/session");
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/auth/session", async (route) => {
      await pending;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Checking access…" })).toBeVisible();
      await expect(page.locator(`#${cardId}`)).toHaveCount(0);
      await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  });
}
