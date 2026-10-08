import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { DocumentsView, TasksView } from "@keycade/contracts";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { workflowApi } from "./closing-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const base = `/applications/${applicationId}`;
const dashboard = `${borrower}${base}?bank=bank-a`;
const pdf = Buffer.from(syntheticDocumentPdf("clean-statement"));
// Synthetic sessions and private documents remain outside browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(100_000);

async function signIn(page: Page) {
  await page.goto(borrower);
  await page.getByLabel("Email address", { exact: true }).fill("borrower@example.test");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.goto(dashboard);
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("contextual pages and browser Back preserve the open task and its unsaved answer", async ({
  page,
}) => {
  await signIn(page);
  const tasks = page.getByRole("region", { name: "Application tasks", exact: true });
  const toggle = tasks.getByRole("button", { name: "Describe your business", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const draft = `Unsaved synthetic dashboard answer ${randomUUID().slice(0, 8)}`;
  await tasks.getByLabel("Your answer", { exact: true }).fill(draft);
  await page.getByRole("link", { name: "View documents", exact: true }).click();
  await expect(page).toHaveURL(`${borrower}${base}/documents?bank=bank-a`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(dashboard);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tasks.getByLabel("Your answer", { exact: true })).toHaveValue(draft);

  await page.getByRole("link", { name: "View activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Application activity", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to task dashboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(dashboard);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tasks.getByLabel("Your answer", { exact: true })).toHaveValue(draft);
  await noOverflow(page);
});

test("sidebar upload is keyboard accessible, retries an interrupted acknowledgement, and stays unlinked to tasks", async ({
  page,
}) => {
  await signIn(page);
  const tasksBefore = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const sidebar = page.getByRole("complementary", { name: "Application details", exact: true });
  await expect(
    sidebar.getByRole("heading", { name: "Upload other documents", exact: true }),
  ).toBeVisible();
  const fileName = `synthetic-sidebar-${randomUUID().slice(0, 8)}.pdf`;
  const pattern = /\/documents\/uploads\/[^/]+\/content$/;
  let intercepted = false;
  let releaseAcknowledgement!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    releaseAcknowledgement = resolve;
  });
  await page.route(pattern, async (route) => {
    if (!intercepted) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await acknowledgement;
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "The upload acknowledgement was interrupted. Retry this file.",
          },
        },
      });
    } else await route.continue();
  });
  try {
    const choosing = page.waitForEvent("filechooser");
    await sidebar.getByRole("button", { name: "Choose files", exact: true }).focus();
    await page.keyboard.press("Enter");
    await (await choosing).setFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
    const upload = sidebar
      .getByRole("list", { name: "Other document upload progress", exact: true })
      .getByRole("listitem")
      .filter({ hasText: fileName });
    await expect(upload.getByRole("progressbar")).toBeVisible();
    releaseAcknowledgement();
    await expect(upload).toContainText("acknowledgement");
    await upload.getByRole("button", { name: "Retry upload", exact: true }).click();
    const saved = sidebar
      .getByRole("list", { name: "Recent other documents", exact: true })
      .getByRole("listitem")
      .filter({ hasText: fileName });
    await expect(saved).toContainText(/Simulated processing complete|Ready for lender review/, {
      timeout: 25_000,
    });
    await expect(saved).toHaveCount(1);
    await expect(upload).toHaveCount(0);
    const documents = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
    const matching = documents.documents.filter(
      (document) => document.versions[0]?.fileName === fileName,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ taskId: null, visibility: "shared" });
    expect(matching[0]?.versions).toHaveLength(1);
    const tasksAfter = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
    expect(
      tasksAfter.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision })),
    ).toEqual(
      tasksBefore.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision })),
    );
    await noOverflow(page);
  } finally {
    releaseAcknowledgement();
    await page.unroute(pattern);
  }
});

test("application progress expands by keyboard and the demo kit leaves both dashboard columns reachable", async ({
  page,
  isMobile,
}, testInfo) => {
  await signIn(page);
  const sidebar = page.getByRole("complementary", { name: "Application details", exact: true });
  const progress = sidebar.getByText("Application progress", { exact: true });
  await progress.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByText("Initial Application Form", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Application In Progress", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Underwriting", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Loan Booked", { exact: true })).toBeVisible();
  const kit = page.getByLabel("Demo scenario kit", { exact: true });
  if (!(await kit.isVisible()))
    await page.getByRole("button", { name: "Show demo kit", exact: true }).click();
  await expect(kit).toBeVisible();
  if (isMobile) {
    await expect(
      page.getByRole("dialog", { name: "Demo scenario kit", exact: true }),
    ).toBeVisible();
  } else {
    const kitBox = await kit.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    const taskBox = await page
      .getByRole("region", { name: "Application tasks", exact: true })
      .boundingBox();
    if (!kitBox || !sidebarBox || !taskBox) throw new Error("Expected visible dashboard regions.");
    expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(kitBox.x + 1);
    expect(taskBox.x + taskBox.width).toBeLessThanOrEqual(sidebarBox.x + 1);
  }
  await kit.getByRole("button", { name: "Hide demo kit", exact: true }).click();
  await expect(kit).not.toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Choose files", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-v2-task-dashboard.png"),
    fullPage: true,
  });
});
