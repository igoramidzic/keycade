import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import type {
  ApplicationSetup,
  DocumentsView,
  DocumentView,
  FinancialCandidate,
  FinancialFactsView,
  ReviewFinancialFacts,
  TasksView,
} from "@keycade/contracts";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
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
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  actionTimeout: 15_000,
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});
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
  ).toBeVisible();
}
async function openDocuments(page: Page, applicationId = seededApplication) {
  await page.goto(`${staff}/applications/${applicationId}/documents?bank=bank-a`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
}
async function freshApplication(page: Page) {
  await signIn(page, borrower, "borrower@example.test");
  let app = await workflowApi<ApplicationSetup>(page, "POST", "/applications", {
    idempotencyKey: randomUUID(),
  });
  for (const step of setupFixtureSteps(`Synthetic Review Workshop ${randomUUID().slice(0, 8)}`))
    app = await workflowApi<ApplicationSetup>(page, "PATCH", `/applications/${app.id}/setup`, {
      expectedRevision: app.revision,
      ...step,
    });
  await workflowApi(page, "POST", `/applications/${app.id}/setup/finish`, {
    definitionVersion: 2,
    expectedRevision: app.revision,
    idempotencyKey: randomUUID(),
  });
  await signIn(page);
  await openDocuments(page, app.id);
  return app.id;
}
function savedRow(page: Page, name: string) {
  return page.getByRole("listitem", { name: `Document ${name}`, exact: true });
}
async function recipeFile(page: Page, applicationId: string, recipe: DemoImportRecipeId) {
  const view = await workflowApi<DocumentsView>(
    page,
    "GET",
    `/applications/${applicationId}/documents`,
  );
  if (!view.demoImportContext) throw new Error("Expected the permitted synthetic context.");
  return {
    name: `${recipe}-${randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(createDemoImportPdf(recipe, view.demoImportContext)),
  };
}
async function uploadRecipe(
  page: Page,
  applicationId: string,
  recipe: DemoImportRecipeId,
  replacement?: Locator,
) {
  const file = await recipeFile(page, applicationId, recipe);
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
  const row = savedRow(page, file.name);
  await expect(row).toContainText("Business name matches", { timeout: 30_000 });
  const view = await workflowApi<DocumentsView>(
    page,
    "GET",
    `/applications/${applicationId}/documents`,
  );
  const document = view.documents.find((item) =>
    item.versions.some((version) => version.fileName === file.name),
  );
  if (!document) throw new Error("Expected saved synthetic document.");
  return { file, row, document };
}
function openButton(row: Locator, fileName: string, version = 1) {
  return row.getByRole("button", { name: `Open ${fileName}, version ${version}`, exact: true });
}
async function openWorkspace(page: Page, row: Locator, fileName: string, version = 1) {
  const button = openButton(row, fileName, version);
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: fileName, exact: true })).toBeVisible();
  return { dialog, button };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
async function previewBytes(dialog: Locator) {
  const preview = dialog.getByRole("region", { name: "Document preview", exact: true });
  const canvas = preview.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const context = element.getContext("2d");
        if (!context || !element.width || !element.height) return false;
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        for (let index = 0; index < pixels.length; index += 4)
          if (pixels[index + 3]! > 0 && pixels[index]! < 180) return true;
        return false;
      }),
    )
    .toBe(true);
  const source = preview.locator("[data-preview-url]");
  await expect(source).toHaveAttribute("data-preview-url", /^blob:/);
  return source.evaluate(async (element) => {
    const response = await fetch(element.getAttribute("data-preview-url")!);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
}
function currentVersion(document: DocumentView) {
  const version = document.versions.find((item) => item.id === document.currentVersionId);
  if (!version) throw new Error("Expected current synthetic version.");
  return version;
}
async function trackPreviewResources(page: Page) {
  await page.addInitScript(() => {
    const revoked: string[] = [];
    Object.assign(window, { workspaceRevokedUrls: revoked });
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      original.call(URL, url);
    };
  });
}
async function expectReleased(page: Page, url: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & { workspaceRevokedUrls: string[] }
          ).workspaceRevokedUrls.includes(url),
        url,
      ),
    )
    .toBe(true);
}
async function previewUrl(dialog: Locator) {
  const source = dialog
    .getByRole("region", { name: "Document preview", exact: true })
    .locator("[data-preview-url]");
  await expect(source).toHaveAttribute("data-preview-url", /^blob:/);
  return (await source.getAttribute("data-preview-url"))!;
}
function financialCommand(
  data: FinancialFactsView,
  candidate: FinancialCandidate,
  disposition: "accept" | "reject" = "accept",
): ReviewFinancialFacts {
  return {
    idempotencyKey: randomUUID(),
    expectedApplicationRevision: data.applicationRevision,
    documentId: candidate.source.documentId,
    versionId: candidate.source.versionId,
    runId: candidate.source.runId,
    expectedRunGeneration: candidate.source.runGeneration,
    expectedCategoryRevision: candidate.source.categoryRevision,
    expectedAnalysisRevision: candidate.source.analysisRevision,
    decisions: [
      {
        fieldKey: candidate.fieldKey,
        disposition,
        expectedFactRevision: candidate.currentFactRevision,
        reason: "Synthetic concurrent reviewer checked this exact source.",
      },
    ],
  };
}

test("three fiscal-year documents keep preview, analysis, source metadata and original downloads aligned", async ({
  page,
  isMobile,
}, testInfo) => {
  await signIn(page);
  await openDocuments(page);
  for (const year of [2023, 2024, 2025] as const) {
    const uploaded = await uploadRecipe(page, seededApplication, `business-tax-return-${year}`);
    const { dialog, button } = await openWorkspace(page, uploaded.row, uploaded.file.name);
    expect(await previewBytes(dialog)).toEqual([...uploaded.file.buffer]);
    await expect(
      dialog.getByRole("region", { name: "PDF page text, page 1", exact: true }),
    ).toContainText(`Period: ${year}-01-01 to ${year}-12-31`);
    await expect(
      dialog.getByRole("region", { name: "Document analysis", exact: true }),
    ).toContainText(`${year}-01-01`);
    await expect(
      dialog.getByRole("region", { name: "Document analysis", exact: true }),
    ).not.toContainText("Simulated");
    await noOverflow(page);
    if (year === 2025)
      await page.screenshot({
        path: testInfo.outputPath(`document-workspace-${isMobile ? "mobile" : "desktop"}.png`),
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    const downloading = page.waitForEvent("download");
    await uploaded.row.getByRole("button", { name: "Download", exact: true }).click();
    const downloaded = await downloading;
    const path = await downloaded.path();
    if (!path) throw new Error("Expected the original synthetic PDF download.");
    expect(await readFile(path)).toEqual(uploaded.file.buffer);
  }
});

test.describe("PDF layout stability", () => {
  test("fit-width PDF preview settles near the scrollbar threshold after opening, paging and resizing", async ({
    page,
  }) => {
    await signIn(page);
    await openDocuments(page);
    // Custom Chromium scrollbars reserve layout width, exercising classic
    // scrollbar layout even on hosts using overlay scrollbars.
    await page.addStyleTag({
      content: "[data-preview-url]::-webkit-scrollbar { width: 16px; height: 16px; }",
    });
    const uploaded = await uploadRecipe(page, seededApplication, "business-tax-return-2023");
    const { dialog } = await openWorkspace(page, uploaded.row, uploaded.file.name);
    expect(await previewBytes(dialog)).toEqual([...uploaded.file.buffer]);
    const preview = dialog.getByRole("region", { name: "Document preview", exact: true });
    const canvas = preview.locator("canvas");
    const scroller = preview.locator("[data-preview-url]");

    async function setScrollbarThreshold() {
      const scrollbarWidth = await scroller.evaluate((element) => {
        const canvas = element.querySelector("canvas")!;
        const style = getComputedStyle(element);
        const fullWidth =
          element.getBoundingClientRect().width -
          Number.parseFloat(style.borderLeftWidth) -
          Number.parseFloat(style.borderRightWidth);
        const html = element as HTMLElement;
        html.style.overflowY = "scroll";
        const scrollbarWidth = fullWidth - element.clientWidth;
        // A fitted page fits, while a 44px in-flow rendering status would overflow.
        html.style.maxHeight = `${fullWidth * (canvas.height / canvas.width) + 20}px`;
        html.style.minHeight = "0";
        html.style.overflowY = "auto";
        return scrollbarWidth;
      });
      expect(scrollbarWidth).toBeGreaterThan(10);
    }
    async function expectSettledPreview(pageNumber: number) {
      // Let browser layout and ResizeObserver deliver the requested geometry change.
      await preview.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        preview.getByRole("region", { name: `PDF page text, page ${pageNumber}`, exact: true }),
      ).not.toBeEmpty();
      await expect(preview.getByRole("status")).toHaveCount(0);
      const rendering = await canvas.evaluate(
        (element) =>
          new Promise<{ canvasChanges: number; renderingFrames: number; emptyFrames: number }>(
            (resolve) => {
              let canvasChanges = 0;
              let renderingFrames = 0;
              let emptyFrames = 0;
              const observer = new MutationObserver((changes) => {
                canvasChanges += changes.length;
              });
              observer.observe(element, { attributes: true, attributeFilter: ["width", "height"] });
              const preview = element.closest("[aria-label='Document preview']")!;
              const deadline = performance.now() + 1_000;
              function frame() {
                if (preview.querySelector("[role='status']")) renderingFrames++;
                if (!element.width || !element.height) emptyFrames++;
                if (performance.now() < deadline) requestAnimationFrame(frame);
                else {
                  observer.disconnect();
                  resolve({ canvasChanges, renderingFrames, emptyFrames });
                }
              }
              requestAnimationFrame(frame);
            },
          ),
      );
      expect(rendering).toEqual({ canvasChanges: 0, renderingFrames: 0, emptyFrames: 0 });
    }

    await setScrollbarThreshold();
    await expectSettledPreview(1);
    await dialog.getByRole("button", { name: "Next page", exact: true }).click();
    await expectSettledPreview(2);
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expectSettledPreview(2);
    await dialog.getByRole("button", { name: "Fit", exact: true }).click();
    await expectSettledPreview(2);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width - 40, height: viewport.height });
    await setScrollbarThreshold();
    await expectSettledPreview(2);
  });
});

test("preview loading and failure stay recoverable and clean Blob resources are released on close", async ({
  page,
}) => {
  await trackPreviewResources(page);
  await signIn(page);
  await openDocuments(page);
  const uploaded = await uploadRecipe(page, seededApplication, "business-tax-return-2023");
  const version = currentVersion(uploaded.document);
  const pattern = new RegExp(`/documents/versions/${version.id}/content$`);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route(pattern, async (route) => {
    if (first) {
      first = false;
      await pending;
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "UNAVAILABLE", message: "Preview transfer interrupted." },
        },
      });
    } else await route.continue();
  });
  try {
    const { dialog, button } = await openWorkspace(page, uploaded.row, uploaded.file.name);
    const preview = dialog.getByRole("region", { name: "Document preview", exact: true });
    await expect(preview.getByRole("status")).toContainText("Loading private preview");
    release();
    await expect(preview.getByRole("alert")).toContainText("Preview transfer interrupted");
    await expect(
      dialog.getByRole("region", { name: "Document analysis", exact: true }),
    ).toContainText("2023-01-01");
    const downloading = page.waitForEvent("download");
    await preview.getByRole("button", { name: "Download document", exact: true }).click();
    const downloaded = await downloading;
    const downloadedPath = await downloaded.path();
    if (!downloadedPath) throw new Error("Expected clean original download after preview failure.");
    expect(await readFile(downloadedPath)).toEqual(uploaded.file.buffer);
    await preview.getByRole("button", { name: "Retry preview", exact: true }).click();
    expect(await previewBytes(dialog)).toEqual([...uploaded.file.buffer]);
    const url = await previewUrl(dialog);
    await dialog.getByRole("button", { name: "Close document workspace", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expectReleased(page, url);
  } finally {
    release();
    await page.unroute(pattern);
  }
});

test("a failed PDF viewer module stays inside the workspace and supports download and reload recovery", async ({
  page,
}) => {
  await trackPreviewResources(page);
  await signIn(page);
  await openDocuments(page);
  const uploaded = await uploadRecipe(page, seededApplication, "business-tax-return-2024");
  const pattern = /\/document-pdf-preview\.tsx(?:\?.*)?$/;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let intercepted = 0;
  await page.route(pattern, async (route) => {
    intercepted++;
    await route.abort("failed");
  });
  const { dialog, button } = await openWorkspace(page, uploaded.row, uploaded.file.name);
  const preview = dialog.getByRole("region", { name: "Document preview", exact: true });
  await expect(preview.getByRole("alert")).toContainText("The PDF viewer could not load");
  expect(intercepted).toBeGreaterThan(0);
  await expect(
    dialog.getByRole("region", { name: "Document analysis", exact: true }),
  ).toContainText("2024-01-01");
  await expect(dialog.getByRole("region", { name: "Document info", exact: true })).toContainText(
    uploaded.file.name,
  );
  const downloading = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download document", exact: true }).click();
  const downloaded = await downloading;
  const path = await downloaded.path();
  if (!path) throw new Error("Expected the original PDF to remain downloadable.");
  expect(await readFile(path)).toEqual(uploaded.file.buffer);
  await page.unroute(pattern);
  await expect(preview.getByRole("alert")).toContainText(
    "Reloading the page will discard unsaved document details and financial review selections",
  );
  await preview.getByRole("button", { name: "Reload page to load viewer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await openWorkspace(page, savedRow(page, uploaded.file.name), uploaded.file.name);
  expect(await previewBytes(dialog)).toEqual([...uploaded.file.buffer]);
  await expect(
    preview.getByRole("region", { name: "PDF page text, page 1", exact: true }),
  ).toContainText("2024 synthetic business tax return");
  expect(errors).toEqual([]);
  const url = await previewUrl(dialog);
  await dialog.getByRole("button", { name: "Close document workspace", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expectReleased(page, url);
});

test("access loss while the document is open removes private preview, cached analysis and financial controls", async ({
  page,
}) => {
  await trackPreviewResources(page);
  await signIn(page);
  await openDocuments(page);
  const uploaded = await uploadRecipe(page, seededApplication, "business-tax-return-2025");
  const { dialog } = await openWorkspace(page, uploaded.row, uploaded.file.name);
  const url = await previewUrl(dialog);
  const pattern = /\/applications\/[^/]+\/documents$/;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Your document access changed." } },
    }),
  );
  await expect(page.getByRole("alert")).toContainText(
    "This application is unavailable for your staff account.",
    {
      timeout: 10_000,
    },
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Saved documents", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Apply selected values", exact: true }),
  ).toHaveCount(0);
  await expectReleased(page, url);
  await page.waitForTimeout(4_000);
  await expect(page.getByRole("alert")).toContainText(
    "This application is unavailable for your staff account.",
  );
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(savedRow(page, uploaded.file.name)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("selected financial review is atomic, corrections preserve suggestions and a stale editor requires deliberate recovery", async ({
  page,
}) => {
  const applicationId = await freshApplication(page);
  const base = `/applications/${applicationId}`;
  const uploaded = await uploadRecipe(page, applicationId, "business-tax-return-2023");
  const tasksBefore = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const { dialog } = await openWorkspace(page, uploaded.row, uploaded.file.name);
  const review = dialog.getByRole("region", { name: "Reviewed financial facts", exact: true });
  const before = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  expect(before.facts).toEqual([]);
  const candidate = (key: string) => {
    const value = before.candidates.find((item) => item.fieldKey === key);
    if (!value) throw new Error(`Missing synthetic ${key} candidate.`);
    return value;
  };
  const revenue = { ...candidate("revenue"), label: "Suggested Revenue / net sales" };
  const adjusted = {
    ...candidate("adjusted_net_income"),
    label: "Suggested Explicit adjusted net income",
  };
  const ordinary = { ...candidate("ordinary_income"), label: "Suggested Ordinary business income" };
  for (const field of [revenue, adjusted, ordinary])
    await review.getByRole("checkbox", { name: `Select ${field.label}`, exact: true }).check();
  await review
    .getByRole("combobox", { name: `Review action for ${ordinary.label}`, exact: true })
    .selectOption("reject");
  await review
    .getByLabel("Reason for financial review", { exact: true })
    .fill("Reviewed the registered synthetic tax schedule; ordinary income remains unaccepted.");
  await review.getByRole("button", { name: "Apply selected values", exact: true }).click();
  await expect(review.getByRole("status")).toContainText(
    "Selected financial reviews saved together",
  );
  let saved = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  expect(
    saved.facts
      .map((fact) => ({ metric: fact.metric, value: fact.value }))
      .sort((a, b) => a.metric.localeCompare(b.metric)),
  ).toEqual([
    { metric: "adjusted_net_income", value: "180000.00" },
    { metric: "revenue", value: "1200000.00" },
  ]);
  expect(saved.history.find((entry) => entry.metric === "ordinary_income")?.disposition).toBe(
    "reject",
  );
  for (const fact of saved.facts) {
    expect(fact.period).toEqual({ start: "2023-01-01", end: "2023-12-31", basis: "fiscal_year" });
    expect(fact.currency).toBe("USD");
    expect(fact.source.versionId).toBe(currentVersion(uploaded.document).id);
  }
  await review
    .getByRole("button", { name: "Page 2 · Explicit adjusted net income", exact: true })
    .click();
  await expect(dialog.getByLabel("Page number", { exact: true })).toHaveValue("2");
  await expect(
    dialog.getByRole("img", {
      name: `Document preview: ${uploaded.file.name}, page 2`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "PDF page text, page 2", exact: true }),
  ).toContainText("Synthetic supporting schedule");

  await review.getByRole("checkbox", { name: `Select ${revenue.label}`, exact: true }).check();
  await review
    .getByRole("combobox", { name: `Review action for ${revenue.label}`, exact: true })
    .selectOption("correct");
  await review
    .getByRole("textbox", { name: `Corrected value for ${revenue.label}` })
    .fill("1200456.78");
  await review
    .getByLabel("Reason for financial review", { exact: true })
    .fill("Explicit synthetic adjustment checked against the source.");
  await expect(
    review.getByRole("button", { name: "Apply selected values", exact: true }),
  ).toBeDisabled();
  await review
    .getByRole("checkbox", { name: `Replace the accepted value for ${revenue.label}`, exact: true })
    .check();
  await review.getByRole("button", { name: "Apply selected values", exact: true }).click();
  await expect(review.getByRole("status")).toContainText(
    "Selected financial reviews saved together",
  );
  saved = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  const corrected = saved.facts.find((fact) => fact.metric === "revenue");
  expect(corrected).toMatchObject({
    value: "1200456.78",
    factRevision: 2,
    disposition: "correct",
    originalCandidate: { value: "1200000.00" },
  });
  expect(saved.history.filter((entry) => entry.metric === "revenue")).toHaveLength(2);

  await review.getByRole("checkbox", { name: `Select ${revenue.label}`, exact: true }).check();
  await review
    .getByRole("combobox", { name: `Review action for ${revenue.label}`, exact: true })
    .selectOption("correct");
  await review
    .getByRole("textbox", { name: `Corrected value for ${revenue.label}` })
    .fill("1200999.99");
  await review
    .getByRole("checkbox", { name: `Replace the accepted value for ${revenue.label}`, exact: true })
    .check();
  await review.getByRole("checkbox", { name: `Select ${ordinary.label}`, exact: true }).check();
  await review
    .getByLabel("Reason for financial review", { exact: true })
    .fill("This selection was prepared before a second review.");
  const gross = saved.candidates.find((field) => field.fieldKey === "gross_sales");
  if (!gross) throw new Error("Expected gross sales source.");
  const concurrent = await workflowApi<FinancialFactsView>(
    page,
    "POST",
    `${base}/financial-facts`,
    financialCommand(saved, gross),
  );
  await review.getByRole("button", { name: "Apply selected values", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Reload before reviewing financial facts");
  await expect(
    review.getByRole("textbox", { name: `Corrected value for ${revenue.label}` }),
  ).toHaveValue("1200999.99");
  const afterConflict = await workflowApi<FinancialFactsView>(
    page,
    "GET",
    `${base}/financial-facts`,
  );
  expect(afterConflict.facts).toEqual(concurrent.facts);
  expect(afterConflict.history).toEqual(concurrent.history);
  await review.getByRole("button", { name: "Reload latest financial values", exact: true }).click();
  await expect(review.getByRole("alert")).toHaveCount(0);
  await expect(
    review.getByRole("checkbox", { name: `Select ${revenue.label}`, exact: true }),
  ).not.toBeChecked();
  await review.getByText(/^Financial review history \(/).click();
  await expect(review).toContainText("Explicit synthetic adjustment checked against the source.");
  const info = dialog.getByRole("region", { name: "Document info", exact: true });
  await info.getByText("Edit document details", { exact: true }).click();
  await info
    .getByRole("textbox", { name: "Display name", exact: true })
    .fill("Reviewed synthetic 2023 tax return");
  await info
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Synthetic tax document with a reviewed fiscal period.");
  await info.getByLabel("Expected period start", { exact: true }).fill("2023-01-01");
  await info.getByLabel("Expected period end", { exact: true }).fill("2023-12-31");
  await info
    .getByRole("textbox", { name: "Reason for metadata change", exact: true })
    .fill("Confirmed the fiscal period from the synthetic source.");
  await info.getByRole("button", { name: "Save document details", exact: true }).click();
  await expect(info.getByRole("status")).toContainText("Document details saved");
  await expect(
    dialog.getByRole("heading", { name: "Reviewed synthetic 2023 tax return", exact: true }),
  ).toBeVisible();
  await expect(info).toContainText(uploaded.file.name);
  await expect(
    dialog.getByRole("region", { name: "Versions and history", exact: true }),
  ).toContainText("Confirmed the fiscal period from the synthetic source.");
  const afterMetadata = await workflowApi<FinancialFactsView>(
    page,
    "GET",
    `${base}/financial-facts`,
  );
  expect(afterMetadata.facts.find((fact) => fact.metric === "revenue")).toMatchObject({
    value: "1200456.78",
    sourceStale: true,
  });
  const tasksAfter = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const states = (data: TasksView) =>
    data.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision }));
  expect(states(tasksAfter)).toEqual(states(tasksBefore));
  await noOverflow(page);
});

test("replacement and reanalysis keep historical bytes and accepted values bound to their exact source", async ({
  page,
}) => {
  await trackPreviewResources(page);
  const applicationId = await freshApplication(page);
  const base = `/applications/${applicationId}`;
  const original = await uploadRecipe(page, applicationId, "business-tax-return-2023");
  const facts = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  const candidate = facts.candidates.find((field) => field.fieldKey === "revenue");
  if (!candidate) throw new Error("Expected original revenue candidate.");
  await workflowApi(page, "POST", `${base}/financial-facts`, financialCommand(facts, candidate));
  const replacement = await uploadRecipe(
    page,
    applicationId,
    "business-tax-return-2024",
    original.row,
  );
  const { dialog } = await openWorkspace(page, replacement.row, replacement.file.name, 2);
  expect(await previewBytes(dialog)).toEqual([...replacement.file.buffer]);
  const newerUrl = await previewUrl(dialog);
  await expect(
    dialog.getByRole("region", { name: "Document analysis", exact: true }),
  ).toContainText("2024-01-01");
  await dialog
    .getByRole("combobox", { name: "Document version", exact: true })
    .selectOption(currentVersion(original.document).id);
  expect(await previewBytes(dialog)).toEqual([...original.file.buffer]);
  await expectReleased(page, newerUrl);
  await expect(
    dialog.getByRole("region", { name: "Document analysis", exact: true }),
  ).toContainText("2023-01-01");
  await expect(dialog.getByRole("region", { name: "Document info", exact: true })).toContainText(
    "1 · Historical",
  );
  await expect(
    dialog.getByRole("region", { name: "Reviewed financial facts", exact: true }),
  ).toContainText("No eligible financial suggestions");
  const history = dialog.getByText(/^Financial review history \(/);
  await history.click();
  await expect(dialog).toContainText("Stale source — review required");
  const stale = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  expect(stale.facts).toHaveLength(1);
  expect(stale.facts[0]).toMatchObject({
    value: "1200000.00",
    sourceStale: true,
    source: { versionId: currentVersion(original.document).id },
  });
  await dialog
    .getByRole("combobox", { name: "Document version", exact: true })
    .selectOption(currentVersion(replacement.document).id);
  await expect(
    dialog.getByRole("region", { name: "Document analysis", exact: true }),
  ).toContainText("2024-01-01");
  const review = dialog.getByRole("region", { name: "Reviewed financial facts", exact: true });
  const revenueLabel = "Suggested Revenue / net sales";
  await review.getByRole("checkbox", { name: `Select ${revenueLabel}`, exact: true }).check();
  await review
    .getByLabel("Reason for financial review", { exact: true })
    .fill("Reviewed the new synthetic fiscal year separately.");
  await review.getByRole("button", { name: "Apply selected values", exact: true }).click();
  await expect(review.getByRole("status")).toContainText(
    "Selected financial reviews saved together",
  );
  const accepted = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  const accepted2024 = accepted.facts.find((fact) => fact.period.start === "2024-01-01");
  if (!accepted2024) throw new Error("Expected independently accepted second fiscal year.");
  await dialog.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect
    .poll(
      async () => {
        const current = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
        return current.documents
          .find((document) => document.id === replacement.document.id)
          ?.versions.find((version) => version.id === currentVersion(replacement.document).id)
          ?.processing?.history.find((run) => run.generation === 2)?.state;
      },
      { timeout: 30_000, intervals: [2000] },
    )
    .toBe("classified");
  const reprocessed = await workflowApi<FinancialFactsView>(page, "GET", `${base}/financial-facts`);
  expect(reprocessed.facts.find((fact) => fact.id === accepted2024.id)).toMatchObject({
    value: "1350000.00",
    sourceStale: true,
    source: { runId: accepted2024.source.runId },
  });
  await dialog
    .getByRole("combobox", { name: "Analysis run", exact: true })
    .selectOption(accepted2024.source.runId);
  await expect(
    dialog.getByRole("region", { name: "Document analysis", exact: true }),
  ).toContainText("Historical analysis");
  await noOverflow(page);
});

test("quarantined documents expose only permitted metadata and failed analysis preserves the clean preview and retry history", async ({
  page,
}) => {
  await signIn(page);
  await openDocuments(page);
  for (const scenario of ["blocked", "processing-error"] as const) {
    const fileName = `synthetic-workspace-${scenario}-${randomUUID().slice(0, 8)}.pdf`;
    const buffer = Buffer.from(syntheticDocumentPdf(scenario));
    await page
      .getByRole("region", { name: "Document upload drop area", exact: true })
      .getByLabel("Choose document files", { exact: true })
      .setInputFiles({ name: fileName, mimeType: "application/pdf", buffer });
    const row = savedRow(page, fileName);
    await expect(row).toContainText(
      scenario === "blocked" ? "Blocked by scan" : "Interpretation failed",
      { timeout: 30_000 },
    );
    const { dialog } = await openWorkspace(page, row, fileName);
    if (scenario === "blocked") {
      await expect(
        dialog.getByRole("region", { name: "Document preview", exact: true }),
      ).toContainText("This file is blocked by the scan");
      await expect(dialog.locator("canvas")).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Download document", exact: true }),
      ).toBeDisabled();
    } else {
      expect(await previewBytes(dialog)).toEqual([...buffer]);
      const analysis = dialog.getByRole("region", { name: "Document analysis", exact: true });
      await expect(analysis).toContainText("Analysis failed");
      await analysis.getByRole("button", { name: "Retry analysis", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await row.getByText("Interpretation history", { exact: true }).click();
      await expect(
        row.getByRole("region", { name: "Interpretation runs", exact: true }),
      ).toContainText("Run 2 · Interpretation failed", { timeout: 30_000 });
      await openWorkspace(page, row, fileName);
      await expect(
        dialog.getByRole("combobox", { name: "Analysis run", exact: true }).locator("option"),
      ).toHaveCount(2);
      await expect(
        dialog.getByRole("region", { name: "Document analysis", exact: true }),
      ).toContainText("Analysis failed");
      expect(await previewBytes(dialog)).toEqual([...buffer]);
    }
    await expect(dialog.getByRole("region", { name: "Document info", exact: true })).toContainText(
      fileName,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await noOverflow(page);
});
