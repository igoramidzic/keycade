import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import type {
  ApplicationSetup,
  ChecksView,
  DocumentsView,
  FinancialFactsView,
  TasksView,
} from "@keycade/contracts";
import { expect as browserExpect, type Page, test } from "@playwright/test";
import { demoImportRecipes } from "../../packages/contracts/src/demo-import";
import { workflowApi } from "./closing-helpers";
import { paceHostedRequests, recordHostedHttpFailures } from "./hosted-helpers";

const env = readEnvironment();
const expect = browserExpect.configure({ timeout: 30_000 });
const borrower = env.KEYCADE_E2E_BORROWER_ORIGIN ?? "";
const staff = env.KEYCADE_E2E_STAFF_ORIGIN ?? "";
test.skip(env.KEYCADE_E2E_HOSTED !== "true", "Explicit hosted acceptance is required.");
// Capture only explicitly selected synthetic views, never session/network artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 25_000 });
test.setTimeout(900_000);

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

test("hosted v2 applicant resumes masked setup and reaches R2 evidence, reviewed metrics and Loan Footprint", async ({
  page,
  context,
  browser,
  isMobile,
}, testInfo) => {
  recordHostedHttpFailures(context, testInfo, "borrower");
  await paceHostedRequests(context);
  const email = `hosted-v2-${randomUUID()}@example.test`;
  const name = `Synthetic Hosted V2 Workshop ${randomUUID().slice(0, 8)}`;
  await page.goto(`${borrower}/apply?bank=bank-a`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Start application", exact: true }).click();
  await page.getByLabel("Legal business name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  if (!applicationId) throw new Error("Hosted v2 application was not created.");
  testInfo.annotations.push({ type: "synthetic_application", description: applicationId });
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
  await page.getByLabel("Business EIN", { exact: true }).fill("000000001");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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
    path: testInfo.outputPath("synthetic-hosted-v2-purposes.png"),
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
    businessEin: { present: true },
    requestedAmount: "42000.00",
    website: "https://synthetic-workshop.example.test/",
    industryCode: "811310",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your application setup", exact: true }),
  ).toBeVisible();
  // Resume exposes only presence and a mask; no raw synthetic identifier in DTO/storage.
  const einSafety = await page.evaluate(async () => {
    const session = await (await fetch("/api/v1/auth/session")).json();
    const applicationId = location.pathname.split("/")[2];
    const setup = await (
      await fetch(`/api/v1/banks/${session.bank.id}/applications/${applicationId}/setup`)
    ).json();
    // Registered UUIDs end in the same digits as the supported synthetic EIN. Exempt only
    // schema-known ID paths, never arbitrary strings or values inside businessEin.
    const idPaths = new Set(["id", "bankId", "businessId", "productId", "selectedProduct.id"]);
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    function containsRawEin(value: unknown, path: string[] = []): boolean {
      if (typeof value === "string") {
        if (idPaths.has(path.join(".")) && uuid.test(value)) return false;
        return value.includes("000000001") || value.includes("00-0000001");
      }
      return (
        value !== null &&
        typeof value === "object" &&
        Object.entries(value).some(([key, entry]) => containsRawEin(entry, [...path, key]))
      );
    }
    return {
      present: setup.businessEin.present === true,
      maskOnly: Boolean(setup.businessEin.mask) && setup.businessEin.mask !== "000000001",
      dtoSafe: !containsRawEin(setup),
      storageSafe: !JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }).includes("000000001"),
    };
  });
  expect(einSafety).toEqual({ present: true, maskOnly: true, dtoSafe: true, storageSafe: true });
  await page.getByRole("button", { name: "Edit business ein", exact: true }).click();
  await expect(page.getByLabel("Business EIN", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Replace saved EIN", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  // Skipping preserves the saved EIN; all remaining saved answers stay available.
  for (const label of ["Industry", "Website", "Requested amount"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(purpose).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeVisible();
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
    path: testInfo.outputPath("synthetic-hosted-v2-dashboard.png"),
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
  await page.screenshot({ path: testInfo.outputPath("synthetic-hosted-v2-scenario-kit.png") });
  const sourceBytes = new Map<string, Buffer>();
  // Every file follows the real reservation, private byte upload, scan and worker pipeline.
  for (const recipe of recipes) {
    const sampleDownload = page.waitForEvent("download");
    await importer
      .getByRole("button", { name: `Download imported ${recipe.title}`, exact: true })
      .click();
    const samplePath = await (await sampleDownload).path();
    if (!samplePath) throw new Error("Generated hosted synthetic source is unavailable.");
    sourceBytes.set(recipe.fileName, await readFile(samplePath));
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
      { timeout: 120_000 },
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
    recordHostedHttpFailures(officerContext, testInfo, "staff");
    await paceHostedRequests(officerContext);
    const officer = await officerContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await officer.goto(`${staff}${base}/overview?bank=bank-a`);
    const financials = officer.getByRole("region", { name: "Financial overview", exact: true });
    await expect(financials).toBeVisible({ timeout: 120_000 });
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
      const privateDownload = officer.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download document", exact: true }).click();
      const privatePath = await (await privateDownload).path();
      if (!privatePath) throw new Error("Hosted private document download is unavailable.");
      expect((await readFile(privatePath)).equals(sourceBytes.get(fileName)!)).toBe(true);
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
          path: testInfo.outputPath("synthetic-hosted-v2-document-modal.png"),
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
      path: testInfo.outputPath("synthetic-hosted-v2-financial-history.png"),
    });
    const footprint = officer.getByRole("button", { name: "Loan Footprint", exact: true });
    await footprint.focus();
    await officer.keyboard.press("Enter");
    const geography = officer.getByRole("dialog", { name: "Geographic Eligibility", exact: true });
    await expect(
      geography.getByText("Within the demo's US footprint.", { exact: true }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(geography).toContainText("123 Synthetic Avenue");
    await expect(geography).toContainText("US-only-demo-v1");
    await expect(geography.getByRole("img")).toBeVisible();
    await noOverflow(officer);
    await geography.screenshot({
      path: testInfo.outputPath("synthetic-hosted-v2-footprint-modal.png"),
    });
    await officer.keyboard.press("Escape");
    await expect(footprint).toBeFocused();
    testInfo.annotations.push({
      type: "hosted_slice",
      description:
        "Expanded setup/resume and mask; four registered imports; R2 original-byte equality; queue analysis; six reviewed facts; address-bound simulated footprint.",
    });
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

test("hosted v2 address changes fence stale runs, refresh replay is idempotent, and an unrelated applicant is denied", async ({
  page,
  context,
  browser,
}, testInfo) => {
  recordHostedHttpFailures(context, testInfo, "staff");
  await paceHostedRequests(context);
  await signIn(page, staff, "officer-a@example.test");
  // Staff prefills remain an unfinished setup and schedule simulated delivery/footprint work.
  const app = await workflowApi<ApplicationSetup>(page, "POST", "/applications", {
    idempotencyKey: randomUUID(),
    email: `hosted-v2-scope-${randomUUID()}@example.test`,
    answers: {
      businessName: "Synthetic Hosted Footprint Revision Workshop",
      businessAddress: {
        line1: "123 Synthetic Avenue",
        locality: "Portland",
        region: "ME",
        postalCode: "04101",
        countryCode: "US",
      },
    },
  });
  testInfo.annotations.push({ type: "synthetic_application", description: app.id });
  expect(app.setupStatus).toBe("in_progress");
  const base = `/applications/${app.id}`;
  const read = () => workflowApi<ChecksView>(page, "GET", `${base}/checks`);
  const footprint = (view: ChecksView) => {
    const check = view.checks.find((item) => item.kind === "loan_footprint");
    if (!check) throw new Error("Hosted synthetic footprint check is missing.");
    return check;
  };
  const current = (view: ChecksView) => {
    const check = footprint(view);
    return check.runs.find((run) => run.id === check.currentRunId);
  };
  await page.goto(`${staff}${base}/overview?bank=bank-a`);
  await page.getByRole("button", { name: "Loan Footprint", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Geographic Eligibility", exact: true });
  await expect(dialog.getByText("Within the demo's US footprint.", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(dialog.getByRole("img")).toBeVisible();
  const before = await read();
  const original = current(before);
  if (!original) throw new Error("Hosted synthetic footprint run is missing.");
  expect(original).toMatchObject({ stale: false, status: "succeeded", outcome: "clear" });
  expect(original.evidence).toMatchObject({ simulated: true });

  const changed = await workflowApi<ApplicationSetup>(page, "PATCH", `${base}/setup`, {
    definitionVersion: 2,
    expectedRevision: app.revision,
    currentStep: "business_address",
    answers: {
      businessAddress: {
        line1: "42 Synthetic Road",
        locality: "Toronto",
        region: "ON",
        postalCode: "M5V 2T6",
        countryCode: "CA",
      },
    },
  });
  expect(changed.businessAddressRevision).toBeGreaterThan(app.businessAddressRevision);
  const invalidated = await read();
  expect(footprint(invalidated).currentRunId).not.toBe(original.id);
  expect(footprint(invalidated).runs.find((run) => run.id === original.id)?.stale).toBe(true);
  expect(current(invalidated)?.footprintInput?.addressRevision).toBe(
    changed.businessAddressRevision,
  );
  await dialog.getByRole("button", { name: "Reload status", exact: true }).click();
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await expect(dialog.getByText("Within the demo's US footprint.", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Outside the demo's US footprint.", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(dialog).toContainText("42 Synthetic Road");
  await expect(dialog).toContainText("US-only-demo-v1");
  await noOverflow(page);
  await dialog.screenshot({ path: testInfo.outputPath("synthetic-hosted-v2-stale-footprint.png") });

  const ready = await read();
  const readyRun = current(ready);
  if (!readyRun) throw new Error("Hosted revised footprint run is missing.");
  expect(readyRun).toMatchObject({ status: "succeeded", stale: false, outcome: "needs_review" });
  const refreshBody = {
    runId: readyRun.id,
    expectedAddressRevision: changed.businessAddressRevision,
  };
  const refreshPath = `${base}/checks/${footprint(ready).id}/refresh`;
  const refreshed = await workflowApi<ChecksView>(page, "POST", refreshPath, refreshBody);
  const replayed = await workflowApi<ChecksView>(page, "POST", refreshPath, refreshBody);
  expect(footprint(refreshed).currentRunId).not.toBe(readyRun.id);
  expect(footprint(replayed).currentRunId).toBe(footprint(refreshed).currentRunId);
  expect(footprint(replayed).runs.length).toBe(footprint(refreshed).runs.length);
  await expect
    .poll(async () => current(await read())?.status, { timeout: 120_000, intervals: [5_000] })
    .toBe("succeeded");
  const after = await read();
  expect(current(after)?.evidence).toMatchObject({
    simulated: true,
    footprint: {
      addressRevision: changed.businessAddressRevision,
      countryCode: "CA",
      coordinates: null,
    },
  });
  expect(footprint(after).required).toBe(false);

  const outsiderContext = await browser.newContext({ viewport: page.viewportSize() });
  recordHostedHttpFailures(outsiderContext, testInfo, "outsider");
  await paceHostedRequests(outsiderContext);
  try {
    const outsider = await outsiderContext.newPage();
    await signIn(outsider, borrower, `hosted-v2-outsider-${randomUUID()}@example.test`);
    // Return only safe status/error metadata, never denied resource bodies or session secrets.
    for (const suffix of ["/setup", "/documents", "/financial-facts", "/checks"]) {
      const denial = await outsider.evaluate(
        async ({ base, suffix, applicationId }) => {
          const session = await (await fetch("/api/v1/auth/session")).json();
          const response = await fetch(`/api/v1/banks/${session.bank.id}${base}${suffix}`);
          const body = await response.json();
          const text = JSON.stringify(body);
          return {
            status: response.status,
            code: body.error?.code,
            resourceDataLeaked:
              text.includes(applicationId) ||
              text.includes("Synthetic Hosted Footprint Revision Workshop") ||
              text.includes("42 Synthetic Road"),
          };
        },
        { base, suffix, applicationId: app.id },
      );
      expect(denial).toEqual({ status: 404, code: "NOT_FOUND", resourceDataLeaked: false });
    }
    testInfo.annotations.push({
      type: "hosted_slice",
      description:
        "Address revision invalidates successful evidence/pin; non-US result; refresh replay creates one successor; unrelated applicant denied setup/documents/metrics/checks without data.",
    });
  } finally {
    await outsiderContext.close();
  }
});
