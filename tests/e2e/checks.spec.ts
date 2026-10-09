import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
// Waiting/settled checks poll every 30 seconds; cross-browser edits must allow that interval.
test.setTimeout(180000);
async function signIn(page: Page, origin: string, email: string) {
  await page.goto(origin);
  await fillSignInEmail(page, email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
async function addSelfOwner(page: Page, applicationId: string) {
  return page.evaluate(
    async ({ applicationId, key }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/participants`;
      const people = await (await fetch(base)).json();
      const person = people.participants.find(
        (person: { email: string }) => person.email === "borrower@example.test",
      );
      const response = await fetch(`${base}/relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
        body: JSON.stringify({
          idempotencyKey: key,
          displayName: "Synthetic browser owner",
          kind: "owner",
          userId: person.userId,
          ownershipPercent: "10",
        }),
      });
      if (!response.ok) throw new Error(`Synthetic owner fixture failed (${response.status}).`);
    },
    { applicationId, key: randomUUID() },
  );
}

test("private synthetic inputs load upfront and drive scoped readiness, review, retry, and stale history", async ({
  page,
  browser,
}, testInfo) => {
  const applicationId =
    testInfo.project.name === "desktop"
      ? "60000000-0000-4000-8000-000000000001"
      : "60000000-0000-4000-8000-000000000002";
  const url = (origin: string, section: string) =>
    `${origin}/applications/${applicationId}/${section}?bank=bank-a`;
  await signIn(page, borrower, "borrower@example.test");
  const staffContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await staffContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await addSelfOwner(officer, applicationId);
    await officer.goto(url(staff, "checks"));
    const fraud = officer.getByRole("region", {
      name: "Business fraud check",
      exact: true,
    });
    await expect(fraud).toContainText("A identifier is needed.");
    await expect(
      officer.getByRole("region", { name: "Submission readiness", exact: true }),
    ).not.toContainText("Business fraud check");
    await expect(
      officer.getByRole("region", { name: "Approval readiness", exact: true }),
    ).toContainText("Business fraud check");
    await page.goto(url(borrower, "tasks"));
    await expect(page.getByRole("heading", { name: "Your tasks", exact: true })).toBeVisible();
    const detailRequests: string[] = [];
    await page.route(/\/tasks\/[0-9a-f-]+$/, async (route) => {
      if (route.request().method() === "GET") {
        detailRequests.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Add business EIN", exact: true }).click();
    const ein = page.getByLabel("Choose an EIN", { exact: true });
    await expect(ein).toBeVisible();
    expect(detailRequests).toEqual([]);
    await expect(page.locator('[id^="task-answer-"]')).toHaveCount(0);
    await ein.selectOption("000000003");
    await page.getByRole("button", { name: "Save identifier", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Identifier saved privately" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete task", exact: true })).toHaveCount(0);
    await expect(fraud.getByText("Needs staff review", { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await expect(
      fraud.getByRole("button", { name: "Record staff resolution", exact: true }),
    ).toBeDisabled();
    await fraud.getByLabel("I reviewed the evidence for this result.").check();
    await fraud.getByRole("button", { name: "Record staff resolution", exact: true }).click();
    await expect(fraud.getByText("Requirement satisfied", { exact: true })).toBeVisible();
    await expect(fraud.getByText("Needs staff review", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Authorize sample tax availability — business", exact: true })
      .click();
    await expect(page.getByLabel("Authorize tax records", { exact: true })).not.toBeChecked();
    await page.getByLabel("Authorize tax records", { exact: true }).check();
    await page.getByRole("button", { name: "Save tax authorization", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Tax authorization saved." }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Add personal identifier/ }).click();
    await page.getByLabel("Choose an SSN", { exact: true }).selectOption("000000001");
    await page.getByRole("button", { name: "Save identifier", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Identifier saved privately" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add business EIN", exact: true }).click();
    await ein.selectOption("000000006");
    await page.getByRole("button", { name: "Save identifier", exact: true }).click();
    await expect(fraud.getByText("Failed", { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(fraud.getByText("Not satisfied", { exact: true })).toBeVisible();
    await fraud.getByText(/^Check history/).click();
    await expect(fraud.getByText("Outdated input", { exact: true }).first()).toBeVisible();
    await expect(fraud.getByText("Staff resolution recorded", { exact: true })).toBeVisible();
    await fraud.getByRole("button", { name: "Retry check", exact: true }).click();
    await expect(fraud.getByRole("status")).toContainText("Check retry requested.");
    await expect(fraud.getByText("Failed", { exact: true }).first()).toBeVisible({
      timeout: 45000,
    });
    await ein.selectOption("000000001");
    await page.getByRole("button", { name: "Save identifier", exact: true }).click();
    await expect(fraud.getByText("Clear", { exact: true }).first()).toBeVisible({
      timeout: 45000,
    });
    await expect(fraud.getByText("Requirement satisfied", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Authorize sample tax availability — business", exact: true })
      .click();
    await expect(page.getByLabel("Authorize tax records", { exact: true })).not.toBeChecked();
    await expect(
      page.getByText("Current authorization: Not granted.", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await noOverflow(officer);
    await officer.screenshot({
      path: testInfo.outputPath("synthetic-check-history.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: testInfo.outputPath("synthetic-private-task.png"),
      fullPage: true,
    });
  } finally {
    await staffContext.close();
  }
});
