import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const id = "60000000-0000-4000-8000-000000000001";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.setTimeout(90000);
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
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
test("staff retries failed work and both dashboards show only currently permitted activity", async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page, staff, "officer-a@example.test");
  await page.goto(`${staff}/applications/${id}/documents?bank=bank-a`);
  const fileName = `synthetic-operations-${randomUUID().slice(0, 8)}.pdf`;
  await page
    .getByRole("region", { name: "Document upload drop area", exact: true })
    .getByLabel("Choose document files", { exact: true })
    .setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("scan-transient")),
    });
  const document = page.getByRole("listitem", { name: `Document ${fileName}`, exact: true });
  await expect(document).toContainText("Simulated scan failed", { timeout: 25000 });
  await page.goto(`${staff}/applications/${id}/operations?bank=bank-a`);
  await expect(
    page.getByRole("heading", { name: "Background operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Responding", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Show operations", exact: true })
    .selectOption("attention");
  const operation = page.getByRole("listitem").filter({ hasText: `Document scan · ${fileName}` });
  await expect(operation).toContainText("1 attempts");
  await operation.getByRole("button", { name: "Retry operation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Retry requested" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Show operations", exact: true })
    .selectOption("document_scan");
  await expect(operation).toContainText("clean", { timeout: 25000 });
  await expect(operation).toContainText("2 attempts");
  await expect(operation.getByRole("button", { name: "Retry operation", exact: true })).toHaveCount(
    0,
  );
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-operations-recovery.png"),
    fullPage: true,
  });
  await page.goto(`${staff}/applications/${id}/activity?bank=bank-a`);
  await expect(
    page.getByRole("heading", { name: "Application activity", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Document scan retried", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Simulated document scan completed", { exact: true }).first(),
  ).toBeVisible();
  const applicantContext = await browser.newContext({ viewport: page.viewportSize() });
  const adviserContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const applicant = await applicantContext.newPage();
    await signIn(applicant, borrower, "borrower@example.test");
    await applicant.goto(`${borrower}/applications/${id}/activity?bank=bank-a`);
    await expect(
      applicant.getByRole("heading", { name: "Application activity", exact: true }),
    ).toBeVisible();
    await expect(
      applicant.getByText("Document scan retried", { exact: true }).first(),
    ).toBeVisible();
    await expect(applicant.getByText("Support reference", { exact: true })).toHaveCount(0);
    await noOverflow(applicant);
    await applicant.screenshot({
      path: testInfo.outputPath("synthetic-borrower-activity.png"),
      fullPage: true,
    });
    const limited = await adviserContext.newPage();
    await signIn(limited, borrower, "adviser@example.test");
    await limited.goto(`${borrower}/applications/${id}/activity?bank=bank-a`);
    await expect(
      limited.getByRole("heading", { name: "Application activity", exact: true }),
    ).toBeVisible();
    await expect(limited.getByText("Document scan retried", { exact: true })).toHaveCount(0);
    await expect(
      limited.getByText("Simulated document scan completed", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await applicantContext.close();
    await adviserContext.close();
  }
});
test("diagnostics hide stale data on a failed refresh and recover with retry", async ({ page }) => {
  await signIn(page, staff, "officer-a@example.test");
  await page.goto(`${staff}/applications/${id}/operations?bank=bank-a`);
  await expect(
    page.getByRole("heading", { name: "Background operations", exact: true }),
  ).toBeVisible();
  await page.route("**/applications/*/operations", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Background operations", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/applications/*/operations");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Background operations", exact: true }),
  ).toBeVisible();
});
