import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

async function signIn(page: Page, origin: string, email: string) {
  await page.goto(origin);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${origin}/applications/${applicationId}/documents?bank=bank-a`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
async function upload(page: Page, scenario: string) {
  const name = `synthetic-${scenario}-${randomUUID().slice(0, 8)}.pdf`;
  await page.getByLabel("Choose document files", { exact: true }).setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(syntheticDocumentPdf(scenario)),
  });
  const document = page.getByRole("listitem", { name: `Document ${name}`, exact: true });
  await expect(document).toBeVisible();
  return { name, document };
}

test("borrower tax uploads appear in grouped tabs with unverified suggestions and unknown files stay reviewable", async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page, borrower, "borrower@example.test");
  await page
    .getByLabel("Attach to", { exact: true })
    .selectOption({ label: "Confirm business identifier readiness" });
  const tax = await upload(page, "clean-tax");
  await expect(tax.document.getByText("Suggested category ready", { exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    tax.document.getByRole("heading", {
      name: "Suggested fields · Simulated, unverified",
      exact: true,
    }),
  ).toBeVisible();
  await expect(tax.document).toContainText(
    "These suggestions do not change confirmed application values.",
  );
  await expect(tax.document.getByText("Correct category", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Tax documents/ }).click();
  await expect(tax.document).toBeVisible();
  await page.getByRole("tab", { name: /^Bank statements/ }).click();
  await expect(tax.document).toHaveCount(0);
  const all = page.getByRole("tab", { name: /^All documents/ });
  await all.click();
  await all.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /^Other/ })).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Other/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(all).toBeFocused();
  await page.getByLabel("Attach to", { exact: true }).selectOption("");

  const unknown = await upload(page, "unknown");
  await expect(
    unknown.document.getByText("Interpretation needs review", { exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await page.getByRole("tab", { name: /^Other/ }).click();
  await expect(unknown.document).toContainText("could not identify this content");
  await expect(
    unknown.document.getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await all.click();
  const uncertain = await upload(page, "low-confidence");
  await expect(
    uncertain.document.getByText("Interpretation needs review", { exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await expect(uncertain.document).toContainText("low confidence");
  await expect(
    uncertain.document.getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-borrower-document-groups.png"),
    fullPage: true,
  });
  await page.goto(`${borrower}/applications/${applicationId}/tasks?bank=bank-a`);
  const task = page.getByRole("button", {
    name: "Confirm business identifier readiness",
    exact: true,
  });
  const statusId = await task.getAttribute("aria-describedby");
  if (!statusId) throw new Error("Expected the task status label.");
  await expect(page.locator(`[id="${statusId}"]`)).toContainText("Open");
  await task.click();
  const answer = page.getByLabel("Your answer", { exact: true });
  const currentAnswer = await answer.inputValue();
  await answer.selectOption(currentAnswer === "confirmed" ? "needs_help" : "confirmed");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Answer submitted" })).toBeVisible();
  const staffContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await staffContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await officer.goto(`${staff}/applications/${applicationId}/tasks?bank=bank-a`);
    await officer
      .getByRole("button", { name: "Confirm business identifier readiness", exact: true })
      .click();
    await expect(
      officer.getByRole("listitem", { name: `Document ${tax.name}`, exact: true }),
    ).toBeVisible();
    await officer
      .getByLabel("Review or waiver reason", { exact: true })
      .fill(
        "Synthetic task evidence reviewed with its original document and simulated suggestions.",
      );
    await officer.getByRole("button", { name: "Complete task", exact: true }).click();
    await expect(officer.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  } finally {
    await staffContext.close();
  }
});

test("staff category correction retains original statement suggestions and correction history", async ({
  page,
}, testInfo) => {
  await signIn(page, staff, "officer-a@example.test");
  const statement = await upload(page, "clean-statement");
  await expect(
    statement.document.getByText("Suggested category ready", { exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await page.getByRole("tab", { name: /^Bank statements/ }).click();
  await expect(statement.document).toBeVisible();
  await expect(statement.document).toContainText("Original suggestion: Bank statements");
  await statement.document.getByText("Correct category", { exact: true }).click();
  await statement.document
    .getByLabel("Staff category", { exact: true })
    .selectOption("business_legal");
  await statement.document
    .getByLabel("Correction reason", { exact: true })
    .fill("Synthetic review identifies this version as a business registration attachment.");
  await statement.document
    .getByRole("button", { name: "Save staff category", exact: true })
    .click();
  await expect(statement.document.getByRole("status")).toContainText("Staff category saved.");
  await expect(statement.document).toContainText("Staff category: Business/legal");
  await expect(statement.document).toContainText("Original suggestion: Bank statements");
  await page.getByRole("tab", { name: /^Business\/legal/ }).click();
  await expect(statement.document).toBeVisible();
  await statement.document.getByText("Interpretation history", { exact: true }).click();
  await expect(
    statement.document.getByRole("region", { name: "Category corrections", exact: true }),
  ).toContainText(
    "Synthetic review identifies this version as a business registration attachment.",
  );
  await expect(
    statement.document.getByRole("region", { name: "Simulated interpretation runs", exact: true }),
  ).toContainText("Original suggestion: Bank statements");
  await statement.document.getByRole("button", { name: "Interpret again", exact: true }).click();
  await expect(
    statement.document.getByRole("region", { name: "Simulated interpretation runs", exact: true }),
  ).toContainText("Run 2 · Suggested category ready", { timeout: 25_000 });
  await expect(statement.document).toContainText("Staff category: Business/legal");
  await expect(statement.document).toContainText("Original suggestion: Bank statements");
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-staff-document-correction.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("tab", { name: /^Business\/legal/ }).click();
  await expect(statement.document).toBeVisible();
  await expect(statement.document).toContainText("Original suggestion: Bank statements");
});

test("failed interpretation preserves download and retry records an additional simulated run", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  const transient = await upload(page, "processing-error");
  await expect(transient.document.getByText("Interpretation failed", { exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    transient.document.getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await transient.document
    .getByRole("button", { name: "Retry interpretation", exact: true })
    .click();
  await transient.document.getByText("Interpretation history", { exact: true }).click();
  const history = transient.document.getByRole("region", {
    name: "Simulated interpretation runs",
    exact: true,
  });
  await expect(history).toContainText("Run 1 · Interpretation failed");
  await expect(history).toContainText("Run 2 · Interpretation failed", { timeout: 25_000 });
  await expect(
    transient.document.getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});

test("restricted participants see category counts only for permitted documents", async ({
  page,
}) => {
  await signIn(page, borrower, "adviser@example.test");
  await expect(page.getByRole("tab", { name: "All documents (0)", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tax documents (0)", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bank statements (0)", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Saved documents", exact: true })).toContainText(
    "No documents are visible for your account yet.",
  );
  await noOverflow(page);
});
