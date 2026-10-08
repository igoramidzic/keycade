import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import type { DocumentsView, ParticipantsWorkspace, TasksView } from "@keycade/contracts";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  createDemoDocumentPdf,
  demoDocuments,
  demoScenarios,
} from "../../packages/contracts/src/demo-scenarios";
import { workflowApi } from "./closing-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const base = `/applications/${applicationId}`;
const businessName = "Synthetic Cedar Workshop";
const demoMime = "application/x-keycade-demo-document";
// Demo sessions and private evidence remain outside Playwright traces.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(150_000);

function fixture(id: string) {
  const document = demoDocuments.find((document) => document.id === id);
  if (!document) throw new Error(`Missing synthetic demonstration document ${id}.`);
  return document;
}
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
  await page.goto(`${origin}${base}/documents?bank=bank-a`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
}
function kit(page: Page) {
  return page.getByLabel("Demo scenario kit", { exact: true });
}
async function openKit(page: Page) {
  if (!(await kit(page).isVisible()))
    await page.getByRole("button", { name: "Show demo kit", exact: true }).click();
  await expect(kit(page)).toBeVisible();
  return kit(page);
}
async function closeKit(page: Page) {
  if (await kit(page).isVisible())
    await kit(page).getByRole("button", { name: "Hide demo kit", exact: true }).click();
  await expect(kit(page)).not.toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
async function chooseScenario(page: Page, id: string) {
  const panel = await openKit(page);
  await panel.getByLabel("Demo scenario", { exact: true }).selectOption(id);
  return panel;
}
function savedDocuments(page: Page, id: string) {
  // Include the underlying list while the mobile kit makes the application inert.
  return page.getByRole("listitem", {
    name: `Document ${fixture(id).fileName}`,
    exact: true,
    includeHidden: true,
  });
}
function savedDocument(page: Page, id: string) {
  return savedDocuments(page, id).first();
}
async function newlySavedDocument(page: Page, id: string, previousCount: number) {
  await expect(savedDocuments(page, id)).toHaveCount(previousCount + 1);
  // The document service returns createdAt descending, so the newly added row is first.
  const saved = savedDocument(page, id);
  await expect(saved).toBeVisible();
  return saved;
}
async function uploadFromKit(page: Page, id: string) {
  const previousCount = await savedDocuments(page, id).count();
  const panel = await openKit(page);
  const upload = panel.getByRole("button", { name: `Upload ${fixture(id).title}`, exact: true });
  await expect(upload).toBeEnabled();
  await upload.focus();
  await page.keyboard.press("Enter");
  await closeKit(page);
  return newlySavedDocument(page, id, previousCount);
}
async function dragFromKit(page: Page, id: string) {
  const previousCount = await savedDocuments(page, id).count();
  const panel = await openKit(page);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await panel
      .getByRole("article", { name: fixture(id).title, exact: true })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    expect(await transfer.evaluate((value) => value.files.length)).toBe(0);
    expect(
      JSON.parse(await transfer.evaluate((value, mime) => value.getData(mime), demoMime)),
    ).toEqual({ id, businessName });
    // A mobile dialog must close before the application's drop target can receive the drag.
    await closeKit(page);
    const target = page.getByRole("region", {
      name: "Document upload drop area",
      exact: true,
    });
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
  return newlySavedDocument(page, id, previousCount);
}
async function download(page: Page, button: Locator) {
  const downloading = page.waitForEvent("download");
  await button.click();
  const result = await downloading;
  const path = await result.path();
  if (!path) throw new Error("Expected downloaded synthetic PDF bytes.");
  return { name: result.suggestedFilename(), bytes: await readFile(path) };
}

test("the separate demo kit stays fixed on desktop, opens on mobile, and retains all scenario choices", async ({
  page,
  isMobile,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  if (isMobile) await expect(kit(page)).not.toBeVisible();
  const panel = await openKit(page);
  await expect(panel).toContainText(businessName);
  await expect(panel).toContainText("borrower@example.test");
  await expect(panel).toContainText("owner@example.test");
  await expect(panel).toContainText("fictional");
  if (isMobile) {
    await expect(
      page.getByRole("dialog", { name: "Demo scenario kit", exact: true }),
    ).toBeVisible();
  } else {
    expect(await panel.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    const colors = await panel.evaluate((element) => ({
      kit: getComputedStyle(element).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    expect(colors.kit).not.toBe(colors.page);
    expect(colors.kit).not.toBe("rgba(0, 0, 0, 0)");
    const bounds = await panel.boundingBox();
    const viewport = page.viewportSize();
    if (!bounds || !viewport) throw new Error("Expected the desktop demo panel bounds.");
    expect(Math.abs(bounds.x + bounds.width - viewport.width)).toBeLessThanOrEqual(2);
  }
  for (const scenario of demoScenarios) {
    await chooseScenario(page, scenario.id);
    for (const document of scenario.documents)
      await expect(panel.getByRole("article", { name: document.title, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.reload();
    await openKit(page);
    await expect(panel.getByLabel("Demo scenario", { exact: true })).toHaveValue(scenario.id);
  }
  await closeKit(page);
  await noOverflow(page);
  await openKit(page);
  await expect(panel.getByLabel("Demo scenario", { exact: true })).toHaveValue("recovery");
  await noOverflow(page);
});

test("kit downloads, internal drags, and keyboard uploads use real PDFs and retain simulated findings for borrower and staff", async ({
  page,
  browser,
  isMobile,
}, testInfo) => {
  await signIn(page, borrower, "borrower@example.test");
  const before = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const readiness = before.tasks.find(
    (task) => task.title === "Confirm business identifier readiness",
  );
  if (!readiness) throw new Error("Expected the seeded business readiness task.");
  const panel = await chooseScenario(page, "clear");
  const sample = await download(
    page,
    panel.getByRole("button", { name: "Download Business tax return", exact: true }),
  );
  expect(sample.name).toBe(fixture("clear-tax").fileName);
  expect(sample.bytes).toEqual(
    Buffer.from(createDemoDocumentPdf(fixture("clear-tax"), businessName)),
  );
  expect(sample.bytes.toString()).toContain("%PDF-1.4");
  expect(sample.bytes.toString()).toContain("FICTIONAL RECORD");
  expect(sample.bytes.toString()).toContain(businessName);

  const tax = await dragFromKit(page, "clear-tax");
  await expect(tax).toContainText("Business name matches", { timeout: 30_000 });
  await expect(tax).toContainText("Simulated document checks");
  await expect(tax).toContainText("Simulated, unverified");
  const uploaded = await download(page, tax.getByRole("button", { name: "Download", exact: true }));
  expect(uploaded.bytes).toEqual(sample.bytes);
  await openKit(page);
  await page.screenshot({
    path: testInfo.outputPath(`synthetic-demo-kit-${isMobile ? "mobile" : "desktop"}.png`),
  });
  await closeKit(page);
  const beforeRepeat = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
  const previousTaxIds = beforeRepeat.documents
    .filter((document) => document.versions[0]?.fileName === fixture("clear-tax").fileName)
    .map((document) => document.id);
  const repeatedTax = await uploadFromKit(page, "clear-tax");
  await expect(repeatedTax).toContainText("Business name matches", { timeout: 30_000 });
  const afterRepeat = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
  const repeatedTaxIds = afterRepeat.documents
    .filter((document) => document.versions[0]?.fileName === fixture("clear-tax").fileName)
    .map((document) => document.id);
  expect(repeatedTaxIds).toHaveLength(previousTaxIds.length + 1);
  expect(new Set(repeatedTaxIds).size).toBe(repeatedTaxIds.length);
  expect(repeatedTaxIds).toEqual(expect.arrayContaining(previousTaxIds));
  const statement = await uploadFromKit(page, "clear-bank");
  await expect(statement).toContainText("Cash flow looks consistent", { timeout: 30_000 });

  // Classification comes from registered contents even when the borrower renames the PDF.
  const renamed = `renamed-synthetic-ein-${randomUUID().slice(0, 8)}.pdf`;
  await page
    .getByRole("region", { name: "Document upload drop area", exact: true })
    .getByLabel("Choose document files", { exact: true })
    .setInputFiles({
      name: renamed,
      mimeType: "application/pdf",
      buffer: Buffer.from(createDemoDocumentPdf(fixture("clear-ein"), businessName)),
    });
  const ein = page.getByRole("listitem", { name: `Document ${renamed}`, exact: true });
  await expect(ein).toContainText("Business name matches", { timeout: 30_000 });
  await page.getByRole("tab", { name: /^Business\/legal/ }).click();
  await expect(ein).toBeVisible();
  await page.getByRole("tab", { name: /^All documents/ }).click();

  await chooseScenario(page, "review");
  const mismatch = await uploadFromKit(page, "review-tax");
  await expect(mismatch).toContainText("Business name does not match", { timeout: 30_000 });
  await expect(mismatch).toContainText("Synthetic Juniper Services");
  await expect(mismatch).toContainText(businessName);
  const cashFlow = await uploadFromKit(page, "review-bank");
  await expect(cashFlow).toContainText("Cash flow needs review", { timeout: 30_000 });
  await expect(cashFlow).toContainText("1200.00");
  const after = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  expect(after.tasks.find((task) => task.id === readiness.id)).toMatchObject({
    state: readiness.state,
    evidenceRevision: readiness.evidenceRevision,
  });
  await page.reload();
  await expect(savedDocument(page, "review-tax")).toContainText("Business name does not match");
  await expect(savedDocument(page, "review-bank")).toContainText("Cash flow needs review");
  await noOverflow(page);

  const officerContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await officerContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await expect(savedDocument(officer, "clear-tax")).toContainText("Business name matches");
    await expect(savedDocument(officer, "review-tax")).toContainText(
      "Business name does not match",
    );
    await expect(savedDocument(officer, "review-bank")).toContainText("Cash flow needs review");
    await expect(savedDocument(officer, "review-bank")).toContainText("Simulated, unverified");
    await noOverflow(officer);
  } finally {
    await officerContext.close();
  }
});

test("the recovery kit demonstrates automatic retry, interpretation failure, quarantine, and unclassified evidence", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  await chooseScenario(page, "recovery");
  const retrying = await uploadFromKit(page, "recovery-bank");
  await expect(retrying).toContainText("Business name matches", { timeout: 40_000 });
  await retrying.getByText("Interpretation history", { exact: true }).click();
  const retryHistory = retrying.getByRole("region", {
    name: "Simulated interpretation runs",
    exact: true,
  });
  await expect(retryHistory).toContainText("Run 1 · Suggested category ready");
  const documents = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
  const recovered = documents.documents.find(
    (document) => document.versions[0]?.fileName === fixture("recovery-bank").fileName,
  );
  expect(recovered?.versions[0]?.processing?.history).toHaveLength(1);
  expect(recovered?.versions[0]?.processing?.history[0]).toMatchObject({
    state: "classified",
    attempts: 2,
  });

  const unreadable = await uploadFromKit(page, "recovery-tax");
  await expect(unreadable).toContainText("Interpretation failed", { timeout: 30_000 });
  await expect(unreadable.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await unreadable.getByRole("button", { name: "Retry interpretation", exact: true }).click();
  await unreadable.getByText("Interpretation history", { exact: true }).click();
  await expect(
    unreadable.getByRole("region", { name: "Simulated interpretation runs", exact: true }),
  ).toContainText("Run 2 · Interpretation failed", { timeout: 30_000 });

  const blocked = await uploadFromKit(page, "recovery-blocked");
  await expect(blocked).toContainText("Blocked by simulated scan", { timeout: 30_000 });
  await expect(blocked.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
  await expect(blocked.getByText("Simulated document checks", { exact: true })).toHaveCount(0);
  const unknown = await uploadFromKit(page, "recovery-unknown");
  await expect(unknown).toContainText("Interpretation needs review", { timeout: 30_000 });
  await page.getByRole("tab", { name: /^Other/ }).click();
  await expect(unknown).toBeVisible();
  await expect(unknown.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await noOverflow(page);
});

test("guarantor kit evidence uses a private task and the restricted adviser cannot bypass backend document access", async ({
  page: officer,
  browser,
}) => {
  await signIn(officer, staff, "officer-a@example.test");
  const people = await workflowApi<ParticipantsWorkspace>(officer, "GET", `${base}/participants`);
  const applicant = people.participants.find((person) => person.email === "borrower@example.test");
  if (!applicant) throw new Error("Expected the seeded synthetic applicant.");
  const name = `Synthetic Demo Guarantor ${randomUUID().slice(0, 8)}`;
  await workflowApi(officer, "POST", `${base}/participants/relationships`, {
    idempotencyKey: randomUUID(),
    displayName: name,
    kind: "owner",
    userId: applicant.userId,
    ownershipPercent: "10",
  });
  const tasks = await workflowApi<TasksView>(officer, "GET", `${base}/tasks`);
  const privateTask = tasks.tasks.find(
    (task) =>
      task.visibility === "private" &&
      task.subjectUserId === applicant.userId &&
      task.inputKind === "answer" &&
      task.title.includes(name),
  );
  if (!privateTask) throw new Error("Expected a private synthetic guarantor task.");
  const borrowerContext = await browser.newContext({ viewport: officer.viewportSize() });
  const adviserContext = await browser.newContext({ viewport: officer.viewportSize() });
  try {
    const applicantPage = await borrowerContext.newPage();
    await signIn(applicantPage, borrower, "borrower@example.test");
    const panel = await chooseScenario(applicantPage, "clear");
    await expect(
      panel.getByRole("button", { name: "Upload Guarantor identity summary", exact: true }),
    ).toBeDisabled();
    const misplaced = await applicantPage.evaluateHandle(() => new DataTransfer());
    try {
      await panel
        .getByRole("article", { name: "Guarantor identity summary", exact: true })
        .dispatchEvent("dragstart", { dataTransfer: misplaced });
      await closeKit(applicantPage);
      await applicantPage
        .getByRole("region", { name: "Document upload drop area", exact: true })
        .dispatchEvent("drop", { dataTransfer: misplaced });
      await expect(
        applicantPage.getByRole("alert").filter({ hasText: "Open the guarantor’s private task" }),
      ).toBeVisible();
      await expect(
        applicantPage.getByRole("listitem", {
          name: `Upload ${fixture("clear-guarantor").fileName}`,
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await misplaced.dispose();
    }
    await applicantPage.goto(`${borrower}${base}/tasks?bank=bank-a&task=${privateTask.id}`);
    await expect(
      applicantPage.getByRole("heading", { name: "Task documents", exact: true }),
    ).toBeVisible();
    const identity = await dragFromKit(applicantPage, "clear-guarantor");
    await expect(identity).toContainText("Suggested category ready", { timeout: 30_000 });
    await expect(identity).toContainText(privateTask.title);
    await expect(identity.getByText("Business name matches", { exact: true })).toHaveCount(0);
    const documents = await workflowApi<DocumentsView>(officer, "GET", `${base}/documents`);
    const privateDocument = documents.documents.find(
      (document) => document.taskId === privateTask.id,
    );
    if (!privateDocument?.currentVersionId) throw new Error("Expected private kit evidence.");
    expect(privateDocument).toMatchObject({
      visibility: "private",
      subjectUserId: applicant.userId,
    });
    await officer.goto(`${staff}${base}/tasks?bank=bank-a&task=${privateTask.id}`);
    await expect(savedDocument(officer, "clear-guarantor")).toBeVisible();

    const adviser = await adviserContext.newPage();
    await signIn(adviser, borrower, "adviser@example.test");
    const adviserKit = await chooseScenario(adviser, "clear");
    await expect(
      adviserKit.getByRole("button", { name: "Upload Business tax return", exact: true }),
    ).toBeDisabled();
    await closeKit(adviser);
    await expect(savedDocument(adviser, "clear-guarantor")).toHaveCount(0);
    const denied = await workflowApi<{ uploads: { error?: string; uploadId?: string }[] }>(
      adviser,
      "POST",
      `${base}/documents/uploads`,
      {
        files: [
          {
            idempotencyKey: randomUUID(),
            fileName: fixture("clear-tax").fileName,
            mimeType: "application/pdf",
            expectedSize: createDemoDocumentPdf(fixture("clear-tax"), businessName).length,
          },
          {
            idempotencyKey: randomUUID(),
            fileName: fixture("clear-guarantor").fileName,
            mimeType: "application/pdf",
            expectedSize: createDemoDocumentPdf(fixture("clear-guarantor"), businessName).length,
            taskId: privateTask.id,
          },
        ],
      },
    );
    expect(denied.uploads).toHaveLength(2);
    for (const upload of denied.uploads) {
      expect(upload.error).toBeTruthy();
      expect(upload.uploadId).toBeUndefined();
    }
    const contentStatus = await adviser.evaluate(async (suffix) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const response = await fetch(`/api/v1/banks/${session.bank.id}${suffix}`);
      await response.body?.cancel();
      return response.status;
    }, `${base}/documents/versions/${privateDocument.currentVersionId}/content`);
    expect(contentStatus).toBe(404);
    const visible = await workflowApi<DocumentsView>(adviser, "GET", `${base}/documents`);
    expect(visible.documents.some((document) => document.id === privateDocument.id)).toBe(false);
    await noOverflow(applicantPage);
    await noOverflow(adviser);
  } finally {
    await borrowerContext.close();
    await adviserContext.close();
  }
});
