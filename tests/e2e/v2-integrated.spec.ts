import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type {
  ApplicationSetup,
  DocumentsView,
  FinancialFactsView,
  TasksView,
} from "@keycade/contracts";
import { expect as browserExpect, type Page, type Route, test } from "@playwright/test";
import { demoImportRecipes } from "../../packages/contracts/src/demo-import";
import { workflowApi } from "./closing-helpers";

const env = readEnvironment();
const expect = browserExpect.configure({ timeout: 15_000 });
const bank = `http://127.0.0.1:${env.BANK_SITE_PORT ?? 3000}`;
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
// Capture only explicitly selected synthetic views, never session/network artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(360_000);

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

test("one new applicant resumes expanded setup and reaches reviewed financial history and Loan Footprint", async ({
  page,
  context,
  browser,
  isMobile,
}, testInfo) => {
  // This combined journey uses the normal API limits even as two role contexts poll.
  let nextRequest = Date.now();
  const pace = async (route: Route) => {
    const turn = Math.max(Date.now(), nextRequest);
    nextRequest = turn + 650;
    await new Promise((resolve) => setTimeout(resolve, turn - Date.now()));
    await route.continue();
  };
  await context.route("**/api/v1/**", pace);
  const email = `integrated-v2-${randomUUID()}@example.test`;
  const name = `Synthetic Integrated Workshop ${randomUUID().slice(0, 8)}`;
  await page.goto(bank);
  await page.getByRole("link", { name: "Apply for business financing", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await page.getByLabel("Legal business name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  expect(applicationId).toBeTruthy();
  const base = `/applications/${applicationId}`;
  for (const [label, value] of [
    ["Street address", "123 Synthetic Avenue"],
    ["City", "Portland"],
    ["State or region", "ME"],
    ["Postal code", "04101"],
    ["Country code", "US"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Business EIN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByLabel("Industry", { exact: true }).click();
  await page.getByRole("combobox", { name: "Search industries", exact: true }).fill("811310");
  await page.getByRole("option", { name: /811310/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Website", { exact: true }).fill("https://synthetic-workshop.example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Requested amount", { exact: true }).fill("42000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: "Equipment purchase", exact: true }).check();
  const purpose = page.getByRole("checkbox", { name: "Working capital", exact: true });
  await purpose.focus();
  await page.keyboard.press("Space");
  await expect(purpose).toBeChecked();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-v2-integrated-purposes.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await context.clearCookies();
  await signIn(page, borrower, email);
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(purpose).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Equipment purchase", exact: true }),
  ).toBeChecked();
  expect(await workflowApi<ApplicationSetup>(page, "GET", `${base}/setup`)).toMatchObject({
    id: applicationId,
    businessName: name,
    currentStep: "purpose",
    setupStatus: "in_progress",
    requestedAmount: "42000.00",
    website: "https://synthetic-workshop.example.test/",
    industryCode: "811310",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your application setup", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page).toHaveURL(`${borrower}${base}?bank=bank-a`);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "Application details", exact: true });
  await expect(sidebar).toContainText("Equipment purchase");
  await expect(sidebar).toContainText("Working capital");
  await sidebar.getByText("Application progress", { exact: true }).click();
  await expect(sidebar.getByText("Initial Application Form", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Loan Booked", { exact: true })).toBeVisible();
  const tasksBefore = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("synthetic-v2-integrated-dashboard.png"),
    fullPage: true,
  });

  const kit = page.getByLabel("Demo scenario kit", { exact: true });
  if (!(await kit.isVisible()))
    await page.getByRole("button", { name: "Show demo kit", exact: true }).click();
  if (isMobile)
    await expect(
      page.getByRole("dialog", { name: "Demo scenario kit", exact: true }),
    ).toBeVisible();
  else {
    const kitBox = await kit.boundingBox();
    const sideBox = await sidebar.boundingBox();
    const taskBox = await page
      .getByRole("region", { name: "Application tasks", exact: true })
      .boundingBox();
    if (!kitBox || !sideBox || !taskBox)
      throw new Error("Expected three visible dashboard regions.");
    expect(sideBox.x + sideBox.width).toBeLessThanOrEqual(kitBox.x + 1);
    expect(taskBox.x + taskBox.width).toBeLessThanOrEqual(sideBox.x + 1);
  }
  const importer = kit.getByRole("region", { name: "Demo text importer", exact: true });
  const recipes = demoImportRecipes.filter((recipe) => recipe.outcome === "clear");
  const choosing = page.waitForEvent("filechooser");
  await importer.getByRole("button", { name: "Choose text files", exact: true }).focus();
  await page.keyboard.press("Enter");
  await (await choosing).setFiles(
    recipes.map((recipe) => ({
      name: recipe.basename,
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic recipe selection only; no financial instructions."),
    })),
  );
  await expect(importer.getByRole("article")).toHaveCount(4);
  await expect(importer).toContainText(name);
  await expect(importer).toContainText("PDF destination: Other application documents");
  await importer.getByRole("article").first().scrollIntoViewIfNeeded();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("synthetic-v2-integrated-scenario-kit.png") });
  // Every file follows the real reservation, private byte upload, scan and worker pipeline.
  for (const recipe of recipes) {
    await importer
      .getByRole("button", { name: `Upload imported ${recipe.title}`, exact: true })
      .click();
    await expect(
      importer.getByRole("button", { name: `Upload imported ${recipe.title}`, exact: true }),
    ).toBeEnabled();
  }
  await kit.getByRole("button", { name: "Hide demo kit", exact: true }).click();
  const recent = sidebar.getByRole("list", { name: "Recent other documents", exact: true });
  for (const recipe of recipes)
    await expect(recent.getByRole("listitem").filter({ hasText: recipe.fileName })).toContainText(
      "Simulated processing complete",
      { timeout: 30_000 },
    );
  const documents = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
  expect(documents.documents).toHaveLength(4);
  for (const document of documents.documents) {
    expect(document.taskId).toBeNull();
    const version = document.versions[0];
    expect(version?.scanState).toBe("clean");
    expect(version?.processing?.history).toHaveLength(1);
    const run = version?.processing?.history[0];
    expect(run).toMatchObject({ state: "classified", stale: false, attempts: 1 });
    expect(run?.result).toMatchObject({ simulated: true, versionId: version?.id });
    expect(Date.parse(run!.result!.completedAt)).toBeGreaterThan(Date.parse(version!.uploadedAt!));
  }
  const tasksAfter = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const taskStates = (tasks: TasksView) =>
    tasks.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision }));
  expect(taskStates(tasksAfter)).toEqual(taskStates(tasksBefore));

  const officerContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    await officerContext.route("**/api/v1/**", pace);
    const officer = await officerContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await officer.goto(`${staff}${base}/overview?bank=bank-a`);
    const financials = officer.getByRole("region", { name: "Financial overview", exact: true });
    await expect(financials).toBeVisible({ timeout: 30_000 });
    await expect(financials).toContainText("Unconfirmed");
    expect(
      (await workflowApi<FinancialFactsView>(officer, "GET", `${base}/financial-facts`)).facts,
    ).toEqual([]);
    const group = officer.getByText("Business tax returns · 3 documents", { exact: true });
    await group.focus();
    await officer.keyboard.press("Enter");
    for (const year of [2023, 2024, 2025]) {
      const fileName = `business-tax-return-${year}.pdf`;
      const trigger = officer.getByRole("button", { name: `Open ${fileName}`, exact: true });
      await trigger.focus();
      await officer.keyboard.press("Enter");
      const dialog = officer.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: fileName, exact: true })).toBeVisible();
      await expect(
        dialog.getByRole("region", { name: "Document preview", exact: true }).locator("canvas"),
      ).toBeVisible();
      await expect(
        dialog.getByRole("region", { name: "PDF page text, page 1", exact: true }),
      ).toContainText(`Period: ${year}-01-01 to ${year}-12-31`);
      const review = dialog.getByRole("region", { name: "Reviewed financial facts", exact: true });
      const candidates = (
        await workflowApi<FinancialFactsView>(officer, "GET", `${base}/financial-facts`)
      ).candidates;
      for (const field of ["revenue", "adjusted_net_income"]) {
        const candidate = candidates.find(
          (item) => item.fieldKey === field && item.period.start === `${year}-01-01`,
        );
        if (!candidate) throw new Error(`Missing synthetic ${year} ${field} suggestion.`);
        await review
          .getByRole("checkbox", { name: `Select ${candidate.label}`, exact: true })
          .check();
      }
      await review
        .getByLabel("Reason for financial review", { exact: true })
        .fill(`Lender checked both values against the registered synthetic ${year} source.`);
      await review.getByRole("button", { name: "Apply selected values", exact: true }).click();
      await expect(review.getByRole("status")).toContainText(
        "Selected financial reviews saved together",
      );
      await noOverflow(officer);
      if (year === 2025) {
        await dialog
          .getByRole("region", { name: "Document preview", exact: true })
          .scrollIntoViewIfNeeded();
        await officer.screenshot({
          path: testInfo.outputPath("synthetic-v2-integrated-document-modal.png"),
        });
      }
      await officer.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await expect(officer.getByText(/3 reviewed, 0 waiting for review/)).toBeVisible();
    const facts = await workflowApi<FinancialFactsView>(officer, "GET", `${base}/financial-facts`);
    expect(facts.facts).toHaveLength(6);
    for (const [metric, values] of [
      ["Revenue", ["$1,200,000.00", "$1,350,000.00", "$1,500,000.00"]],
      ["Adjusted net income", ["$180,000.00", "$210,000.00", "$240,000.00"]],
    ] as const) {
      await financials
        .getByRole("button", { name: `${metric} period history`, exact: true })
        .click();
      const table = financials.getByRole("table", {
        name: `${metric} period history`,
        exact: true,
      });
      await expect(table.getByRole("row")).toHaveCount(4);
      for (const [index, year] of [2023, 2024, 2025].entries()) {
        const row = table.getByRole("row").filter({ hasText: `Fiscal year ${year}` });
        await expect(row).toContainText(values[index]!);
        await expect(row).toContainText("Current");
      }
      await expect(table).not.toContainText("2026");
    }
    await financials.screenshot({
      path: testInfo.outputPath("synthetic-v2-integrated-financial-history.png"),
    });
    const footprint = officer.getByRole("button", { name: "Loan Footprint", exact: true });
    await footprint.focus();
    await officer.keyboard.press("Enter");
    const geography = officer.getByRole("dialog", { name: "Geographic Eligibility", exact: true });
    await expect(
      geography.getByText("Within the demo's US footprint.", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(geography).toContainText("123 Synthetic Avenue");
    await expect(geography).toContainText("US-only-demo-v1");
    await expect(geography.getByRole("img")).toBeVisible();
    await noOverflow(officer);
    await geography.screenshot({
      path: testInfo.outputPath("synthetic-v2-integrated-footprint-modal.png"),
    });
    await officer.keyboard.press("Escape");
    await expect(footprint).toBeFocused();
    // Extraction and lender fact review do not silently complete requirements or advance stage.
    expect((await workflowApi<ApplicationSetup>(page, "GET", `${base}/setup`)).status).toBe(
      "collecting_information",
    );
    expect(taskStates(await workflowApi<TasksView>(page, "GET", `${base}/tasks`))).toEqual(
      taskStates(tasksBefore),
    );
  } finally {
    await officerContext.close();
  }
});
