import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type {
  ApplicationSetup,
  DocumentsView,
  DocumentView,
  FinancialFactsView,
  ReviewFinancialFacts,
  TasksView,
  TaskView,
} from "@keycade/contracts";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  createDemoImportPdf,
  type DemoImportRecipeId,
} from "../../packages/contracts/src/demo-import";
import { setupFixtureSteps } from "../setup-fixture";
import { workflowApi } from "./closing-helpers";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const seededApplication = "60000000-0000-4000-8000-000000000001";
const productId = "50000000-0000-4000-8000-000000000001";
// Keep synthetic sessions and private evidence outside automatic browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(120_000);

async function signIn(page: Page, origin = staff, email = "officer-a@example.test") {
  await page.goto(origin);
  await fillSignInEmail(page, email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20_000 });
}

async function openSection(page: Page, applicationId: string, section = "overview") {
  await page.goto(`${staff}/applications/${applicationId}/${section}?bank=bank-a`);
  await expect(
    page.getByRole("heading", {
      name: section === "documents" ? "Documents" : "Business profile",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
}

async function freshApplication(page: Page, completeDescription = false) {
  const businessName = `Synthetic Overview Workshop ${randomUUID().slice(0, 8)}`;
  await signIn(page, borrower, "borrower@example.test");
  let app = await workflowApi<ApplicationSetup>(page, "POST", "/applications", {
    idempotencyKey: randomUUID(),
  });
  for (const step of setupFixtureSteps(businessName, "42000.00")) {
    const answers =
      step.step === "industry"
        ? { industryCode: "811310", industryTaxonomyVersion: "2022" }
        : step.step === "website"
          ? { website: "https://synthetic-overview.example.test" }
          : step.step === "purpose"
            ? {
                fundingPurposes: ["equipment_purchase", "working_capital"],
                purposeCatalogVersion: "2026-01",
              }
            : step.answers;
    app = await workflowApi<ApplicationSetup>(page, "PATCH", `/applications/${app.id}/setup`, {
      ...step,
      skip: step.step === "industry" || step.step === "website" ? false : step.skip,
      answers,
      expectedRevision: app.revision,
    });
  }
  app = await workflowApi<ApplicationSetup>(page, "POST", `/applications/${app.id}/setup/finish`, {
    definitionVersion: 2,
    expectedRevision: app.revision,
    idempotencyKey: randomUUID(),
  });
  if (!completeDescription) {
    await signIn(page);
    return { applicationId: app.id, businessName };
  }
  const tasks = await workflowApi<TasksView>(page, "GET", `/applications/${app.id}/tasks`);
  const description = tasks.tasks.find((task) => task.title === "Describe your business");
  if (!description) throw new Error("Expected the synthetic business-description requirement.");
  let completed = await workflowApi<TaskView>(
    page,
    "PATCH",
    `/applications/${app.id}/tasks/${description.id}/answer`,
    { expectedRevision: description.revision, answer: "Synthetic equipment repair workshop." },
  );
  completed = await workflowApi<TaskView>(
    page,
    "POST",
    `/applications/${app.id}/tasks/${description.id}/submit`,
    { expectedRevision: completed.revision },
  );
  await signIn(page);
  await workflowApi(page, "POST", `/applications/${app.id}/tasks/${description.id}/review`, {
    expectedRevision: completed.revision,
    decision: "completed",
    reason: "Reviewed this synthetic overview fixture's written response.",
  });
  return { applicationId: app.id, businessName };
}

function documentRow(page: Page, name: string) {
  return page.getByRole("listitem", { name: `Document ${name}`, exact: true });
}

function currentVersion(document: DocumentView) {
  const version = document.versions.find((item) => item.id === document.currentVersionId);
  if (!version) throw new Error("Expected a saved synthetic document version.");
  return version;
}

async function uploadRecipe(
  page: Page,
  applicationId: string,
  recipe: DemoImportRecipeId,
  replacement?: Locator,
) {
  const view = await workflowApi<DocumentsView>(
    page,
    "GET",
    `/applications/${applicationId}/documents`,
  );
  if (!view.demoImportContext) throw new Error("Expected authorized synthetic import context.");
  const file = {
    name: `${recipe}-${randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(createDemoImportPdf(recipe, view.demoImportContext)),
  };
  if (replacement) {
    const choosing = page.waitForEvent("filechooser");
    await replacement.getByRole("button", { name: "Upload replacement", exact: true }).click();
    await (await choosing).setFiles(file);
  } else {
    await page
      .getByRole("region", { name: "Document upload drop area", exact: true })
      .getByLabel("Choose document files", { exact: true })
      .setInputFiles(file);
  }
  const row = documentRow(page, file.name);
  await expect(row).toContainText("Business name matches", { timeout: 30_000 });
  const saved = await workflowApi<DocumentsView>(
    page,
    "GET",
    `/applications/${applicationId}/documents`,
  );
  const document = saved.documents.find((item) =>
    item.versions.some((version) => version.fileName === file.name),
  );
  if (!document) throw new Error("Expected the saved synthetic tax return.");
  return { file, row, document };
}

async function reviewFinancials(page: Page, applicationId: string, documentId: string) {
  const base = `/applications/${applicationId}/financial-facts`;
  const view = await workflowApi<FinancialFactsView>(page, "GET", base);
  const candidates = view.candidates.filter(
    (candidate) =>
      candidate.source.documentId === documentId &&
      ["revenue", "adjusted_net_income"].includes(candidate.fieldKey),
  );
  expect(candidates).toHaveLength(2);
  const source = candidates[0]?.source;
  if (!source) throw new Error("Expected the supplied revenue and adjusted-income candidates.");
  const command: ReviewFinancialFacts = {
    idempotencyKey: randomUUID(),
    expectedApplicationRevision: view.applicationRevision,
    documentId,
    versionId: source.versionId,
    runId: source.runId,
    expectedRunGeneration: source.runGeneration,
    expectedCategoryRevision: source.categoryRevision,
    expectedAnalysisRevision: source.analysisRevision,
    decisions: candidates.map((candidate) => ({
      fieldKey: candidate.fieldKey,
      disposition: "accept",
      expectedFactRevision: candidate.currentFactRevision,
      reason: "Lender reviewed this registered synthetic fiscal-year source.",
    })),
  };
  return workflowApi<FinancialFactsView>(page, "POST", base, command);
}

async function previewBytes(dialog: Locator) {
  const preview = dialog.getByRole("region", { name: "Document preview", exact: true });
  const canvas = preview.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const context = element.getContext("2d");
          if (!context || !element.width || !element.height) return false;
          const pixels = context.getImageData(0, 0, element.width, element.height).data;
          for (let index = 0; index < pixels.length; index += 4)
            if (pixels[index + 3]! > 0 && pixels[index]! < 180) return true;
          return false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  const source = preview.locator("[data-preview-url]");
  await expect(source).toHaveAttribute("data-preview-url", /^blob:/);
  return source.evaluate(async (element) => {
    const response = await fetch(element.getAttribute("data-preview-url")!);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("filtered second-page queue opens Overview and retains filters through the existing staff tabs", async ({
  page,
}) => {
  await signIn(page);
  const prefix = `Synthetic Overview Queue ${randomUUID().slice(0, 8)}`;
  for (let index = 1; index <= 6; index++)
    await workflowApi(page, "POST", "/staff/applications", {
      idempotencyKey: randomUUID(),
      email: `overview-queue-${randomUUID()}@example.test`,
      answers: { businessName: `${prefix} ${index}` },
    });
  await page.reload();
  await page.getByLabel("Search applications", { exact: true }).fill(prefix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("search") === prefix);
  for (const [label, key, value] of [
    ["Stage", "status", "draft"],
    ["Product", "productId", productId],
    ["Assignee", "assigneeId", "unassigned"],
    ["Sort by", "sort", "business_asc"],
    ["Rows per page", "limit", "5"],
  ] as const) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
    await expect(page).toHaveURL((url) => url.searchParams.get(key) === value);
    await expect(page).toHaveURL((url) => url.searchParams.get("search") === prefix);
  }
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("page") === "2");
  const queueUrl = page.url();
  const application = page.getByRole("link", { name: `${prefix} 6`, exact: true });
  await application.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => url.pathname.endsWith("/overview"));
  for (const name of [
    "Business profile",
    "Financial overview",
    "Loan application",
    "Application stages",
  ])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  const financials = page.getByRole("region", { name: "Financial overview", exact: true });
  await expect(financials).toContainText("Missing");
  await expect(financials).not.toContainText("$0.00");
  const emptyRevenue = financials.getByRole("button", {
    name: "Revenue period history",
    exact: true,
  });
  await emptyRevenue.focus();
  await page.keyboard.press("Enter");
  await expect(
    financials
      .getByRole("region", { name: "Revenue period history details", exact: true })
      .getByText(/No reviewed periods to chart/),
  ).toBeVisible();
  await expect(
    financials.getByRole("img", { name: "Revenue period history chart", exact: true }),
  ).toHaveCount(0);
  const emptyTaxGroup = page.getByText("Business tax returns · 0 documents", { exact: true });
  await emptyTaxGroup.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/No business tax documents uploaded/)).toBeVisible();
  for (const name of [
    "Overview",
    "Participants",
    "Tasks",
    "Documents",
    "Checks",
    "Review",
    "Closing",
    "Activity",
    "Operations",
    "Signatures",
    "Internal notes",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Internal notes", exact: true }).click();
  await expect(page.getByLabel("New internal note", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to applications", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(queueUrl);
  await expect(page.getByLabel("Search applications", { exact: true })).toHaveValue(prefix);
  await expect(page.getByLabel("Rows per page", { exact: true })).toHaveValue("5");
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeEnabled();
  await expect(application).toBeVisible();

  await openSection(page, seededApplication);
  const profile = page.getByRole("region", { name: "Business profile", exact: true });
  await expect(profile).toContainText("Not provided");
  await expect(profile).toContainText(/legacy/i);
  await expect(
    page.getByRole("region", { name: "Financial overview", exact: true }),
  ).not.toContainText("$0.00");
  await noOverflow(page);
});

test("v2 business and loan details, current and finished items, and scenario controls remain reachable", async ({
  page,
  isMobile,
}, testInfo) => {
  const { applicationId, businessName } = await freshApplication(page, true);
  await openSection(page, applicationId);
  const profile = page.getByRole("region", { name: "Business profile", exact: true });
  await expect(profile).toContainText(businessName);
  await expect(profile).toContainText("123 Synthetic Avenue");
  await expect(profile).toContainText("Portland");
  await expect(profile).toContainText("811310");
  await expect(
    profile.getByRole("link", { name: "https://synthetic-overview.example.test/", exact: true }),
  ).toHaveAttribute("href", "https://synthetic-overview.example.test/");
  const loan = page.getByRole("region", { name: "Loan application", exact: true });
  await expect(loan).toContainText("$42,000");
  await expect(loan).toContainText("Equipment purchase");
  await expect(loan).toContainText("Working capital");
  const stages = page.getByRole("region", { name: "Application stages", exact: true });
  await expect(stages).toContainText("Current stage: Collecting information");
  for (const label of ["Initial setup", "Approval", "Closing"]) {
    const summary = stages.getByRole("button", { name: new RegExp(`^${label}`) });
    await summary.focus();
    await page.keyboard.press("Enter");
  }
  await expect(stages).toContainText("Action required");
  await expect(stages).toContainText("Completed answer");
  await expect(stages).toContainText("Requirement record");
  await expect(stages).toContainText("Check result");
  await expect(stages).toContainText("Describe your business");
  await expect(stages).toContainText("Completed");
  await expect(page.getByRole("link", { name: "View full activity", exact: true })).toBeVisible();

  const kit = page.getByLabel("Sample scenario kit", { exact: true });
  if (!(await kit.isVisible()))
    await page.getByRole("button", { name: "Show sample kit", exact: true }).click();
  await expect(kit).toBeVisible();
  if (isMobile)
    await expect(
      page.getByRole("dialog", { name: "Sample scenario kit", exact: true }),
    ).toBeVisible();
  else {
    const kitBox = await kit.boundingBox();
    const profileBox = await profile.boundingBox();
    if (!kitBox || !profileBox) throw new Error("Expected visible overview and demo regions.");
    expect(profileBox.x + profileBox.width).toBeLessThanOrEqual(kitBox.x + 1);
  }
  await kit.getByRole("button", { name: "Hide sample kit", exact: true }).click();
  await expect(kit).not.toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`synthetic-lender-overview-${isMobile ? "mobile" : "desktop"}.png`),
    fullPage: true,
  });
});

test("three tax documents keep replacement counts separate and open the matching private analysis by keyboard", async ({
  page,
}) => {
  const { applicationId } = await freshApplication(page);
  await openSection(page, applicationId, "documents");
  const documents = [];
  for (const year of [2023, 2024, 2025] as const)
    documents.push(await uploadRecipe(page, applicationId, `business-tax-return-${year}`));
  const original = documents[0];
  if (!original) throw new Error("Expected the 2023 synthetic document.");
  const replacement = await uploadRecipe(
    page,
    applicationId,
    "business-tax-return-2023",
    original.row,
  );
  await openSection(page, applicationId);
  const group = page.getByText("Business tax returns · 3 documents", { exact: true });
  await group.focus();
  await page.keyboard.press("Enter");
  for (const uploaded of [replacement, ...documents.slice(1)]) {
    const open = page.getByRole("button", { name: `Open ${uploaded.file.name}`, exact: true });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await previewBytes(dialog)).toEqual([...uploaded.file.buffer]);
    await expect(
      dialog.getByRole("combobox", { name: "Document version", exact: true }),
    ).toHaveValue(currentVersion(uploaded.document).id);
    const year = uploaded.file.name.match(/(202[345])/)?.[1];
    await expect(
      dialog.getByRole("region", { name: "Document analysis", exact: true }),
    ).toContainText(`${year}-01-01`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  }
  await expect(page.getByText("Business tax returns · 4 documents", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(/2 versions · waiting for review/)).toBeVisible();
  await expect(page.getByText(/4 file versions · 0 reviewed, 3 waiting for review/)).toBeVisible();
  const financials = page.getByRole("region", { name: "Financial overview", exact: true });
  await expect(financials).toContainText("Unconfirmed");
  await expect(financials).not.toContainText("$0.00");
  await noOverflow(page);
});

test("reviewed financial history has an equivalent table and stale values retain their exact historical evidence", async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(240_000);
  // This deliberate fixture-heavy journey keeps the real API's 120/minute limit enabled.
  let nextRequest = Date.now();
  await page.route("**/api/v1/**", async (route) => {
    const turn = Math.max(Date.now(), nextRequest);
    nextRequest = turn + 650;
    await new Promise((resolve) => setTimeout(resolve, turn - Date.now()));
    await route.continue();
  });
  const { applicationId } = await freshApplication(page);
  await openSection(page, applicationId, "documents");
  const documents = [];
  for (const year of [2023, 2024, 2025] as const) {
    const uploaded = await uploadRecipe(page, applicationId, `business-tax-return-${year}`);
    await reviewFinancials(page, applicationId, uploaded.document.id);
    documents.push(uploaded);
  }
  const original = documents[2];
  if (!original) throw new Error("Expected accepted synthetic 2025 evidence.");
  await openSection(page, applicationId);
  const financials = page.getByRole("region", { name: "Financial overview", exact: true });
  for (const [metric, values] of [
    ["Revenue", ["$1,200,000.00", "$1,350,000.00", "$1,500,000.00"]],
    ["Adjusted net income", ["$180,000.00", "$210,000.00", "$240,000.00"]],
  ] as const) {
    const card = financials.getByRole("button", { name: `${metric} period history`, exact: true });
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(
      financials.getByRole("img", { name: `${metric} period history chart`, exact: true }),
    ).toBeVisible();
    const table = financials.getByRole("table", { name: `${metric} period history`, exact: true });
    await expect(table.getByRole("row")).toHaveCount(4);
    for (const [index, year] of [2023, 2024, 2025].entries()) {
      const row = table.getByRole("row").filter({ hasText: `Fiscal year ${year}` });
      await expect(row).toContainText(values[index]!);
      await expect(row).toContainText("Current");
    }
    await expect(table).not.toContainText("2026");
  }
  await page.getByText("Business tax returns · 3 documents", { exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath(`synthetic-financial-history-${isMobile ? "mobile" : "desktop"}.png`),
    fullPage: true,
  });
  await financials.screenshot({
    path: testInfo.outputPath(`financial-history-region-${isMobile ? "mobile" : "desktop"}.png`),
  });
  const sourceName = `Open Revenue source for Fiscal year 2025, version ${currentVersion(original.document).id}`;
  const source = financials
    .getByRole("table", { name: "Revenue period history", exact: true })
    .getByRole("button", { name: sourceName, exact: true });
  await source.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  expect(await previewBytes(dialog)).toEqual([...original.file.buffer]);
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();

  await openSection(page, applicationId, "documents");
  await uploadRecipe(
    page,
    applicationId,
    "business-tax-return-2024",
    documentRow(page, original.file.name),
  );
  await openSection(page, applicationId);
  const revenue = financials.getByRole("button", { name: "Revenue period history", exact: true });
  await expect(revenue).toContainText("$1,500,000.00", { timeout: 20_000 });
  await expect(revenue).toContainText("Stale source");
  await revenue.focus();
  await page.keyboard.press("Enter");
  await source.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  expect(await previewBytes(dialog)).toEqual([...original.file.buffer]);
  await expect(dialog.getByRole("combobox", { name: "Document version", exact: true })).toHaveValue(
    currentVersion(original.document).id,
  );
  await expect(dialog.getByRole("region", { name: "Document info", exact: true })).toContainText(
    "Historical",
  );
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();
  await noOverflow(page);
});

test("Overview loading and temporary aggregate failures recover without losing existing navigation", async ({
  page,
}) => {
  await signIn(page);
  const pattern = /\/applications\/[^/]+\/overview$/;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      json: {
        error: { code: "UNAVAILABLE", message: "Overview temporarily unavailable." },
      },
    });
  });
  try {
    await page.goto(`${staff}/applications/${seededApplication}/overview?bank=bank-a`);
    await expect(
      page.getByRole("status").filter({ hasText: "Loading financial overview and evidence" }),
    ).toBeVisible();
    release();
    await expect(page.getByRole("alert")).toContainText("Overview temporarily unavailable");
    await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
    await page.unroute(pattern);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("region", { name: "Business profile", exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Financial overview", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  } finally {
    release();
    await page.unroute(pattern);
  }
});

test("an Overview document cache refreshes for a newly discovered replacement without losing the evidence group", async ({
  page,
  context,
}) => {
  const { applicationId } = await freshApplication(page);
  await openSection(page, applicationId, "documents");
  const original = await uploadRecipe(page, applicationId, "business-tax-return-2023");
  await openSection(page, applicationId);
  const group = page.getByText("Business tax returns · 1 document", { exact: true });
  await group.focus();
  await page.keyboard.press("Enter");
  const originalButton = page.getByRole("button", {
    name: `Open ${original.file.name}`,
    exact: true,
  });
  await originalButton.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  expect(await previewBytes(dialog)).toEqual([...original.file.buffer]);
  await page.keyboard.press("Escape");
  await expect(originalButton).toBeFocused();

  const otherPage = await context.newPage();
  try {
    await openSection(otherPage, applicationId, "documents");
    const replacement = await uploadRecipe(
      otherPage,
      applicationId,
      "business-tax-return-2024",
      documentRow(otherPage, original.file.name),
    );
    await otherPage.close();
    await page.bringToFront();
    const replacementButton = page.getByRole("button", {
      name: `Open ${replacement.file.name}`,
      exact: true,
    });
    await expect(replacementButton).toBeVisible({ timeout: 25_000 });
    await replacementButton.focus();
    await page.keyboard.press("Enter");
    dialog = page.getByRole("dialog");
    expect(await previewBytes(dialog)).toEqual([...replacement.file.buffer]);
    await expect(
      dialog.getByRole("combobox", { name: "Document version", exact: true }),
    ).toHaveValue(currentVersion(replacement.document).id);
    await expect(
      dialog.getByRole("region", { name: "Document analysis", exact: true }),
    ).toContainText("2024-01-01");
    await expect(
      page.getByText("This document is no longer available to your staff account.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(replacementButton).toBeFocused();
    await expect(group).toBeVisible();
    await expect(page.getByText(/2 file versions/)).toBeVisible();
    await noOverflow(page);
  } finally {
    if (!otherPage.isClosed()) await otherPage.close();
  }
});
