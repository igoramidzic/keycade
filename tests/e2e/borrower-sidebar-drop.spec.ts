import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { DocumentsView, TasksView } from "@keycade/contracts";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, test } from "@playwright/test";
import { workflowApi } from "./closing-helpers";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const base = `/applications/${applicationId}`;
// Keep synthetic session credentials and document bytes outside browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(100_000);

test("sidebar file drops use the general application target and expose scan and processing retries", async ({
  page,
}) => {
  await page.goto(borrower);
  await fillSignInEmail(page, "borrower@example.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.goto(`${borrower}${base}?bank=bank-a`);
  await page.getByRole("button", { name: "Describe your business", exact: true }).click();
  const tasksBefore = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  const sidebar = page.getByRole("region", { name: "Upload other documents", exact: true });
  const dropArea = sidebar.getByRole("region", {
    name: "Other document upload drop area",
    exact: true,
  });
  const scanName = `synthetic-sidebar-drop-scan-${randomUUID().slice(0, 8)}.pdf`;
  const processingName = `synthetic-sidebar-drop-processing-${randomUUID().slice(0, 8)}.pdf`;
  const files = [
    { name: scanName, bytes: Array.from(syntheticDocumentPdf("scan-transient")) },
    { name: processingName, bytes: Array.from(syntheticDocumentPdf("processing-error")) },
  ];
  const transfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const file of files)
      transfer.items.add(
        new File([new Uint8Array(file.bytes)], file.name, { type: "application/pdf" }),
      );
    return transfer;
  }, files);
  const reserved = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`${base}/documents/uploads`),
  );
  try {
    await dropArea.dispatchEvent("dragover", { dataTransfer: transfer });
    await dropArea.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
  const reservation = (await reserved).postDataJSON() as { files: object[] };
  expect(reservation.files).toHaveLength(2);
  for (const file of reservation.files) expect(file).not.toHaveProperty("taskId");
  const saved = sidebar.getByRole("list", { name: "Recent other documents", exact: true });
  const scanned = saved.getByRole("listitem").filter({ hasText: scanName });
  const processed = saved.getByRole("listitem").filter({ hasText: processingName });
  await expect(scanned).toContainText("Scan failed", { timeout: 25_000 });
  await expect(processed).toContainText("Processing failed", { timeout: 25_000 });
  await scanned.getByRole("button", { name: "Retry scan", exact: true }).click();
  await expect(scanned).toContainText(/Processing complete|Ready for lender review/, {
    timeout: 25_000,
  });
  await processed.getByRole("button", { name: "Retry processing", exact: true }).click();
  await expect
    .poll(
      async () => {
        const result = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
        return result.documents
          .find((document) => document.versions[0]?.fileName === processingName)
          ?.versions[0]?.processing?.history.filter((run) => run.state === "failed").length;
      },
      { timeout: 25_000 },
    )
    .toBe(2);
  await expect(processed).toContainText("Processing failed", { timeout: 25_000 });
  const result = await workflowApi<DocumentsView>(page, "GET", `${base}/documents`);
  for (const name of [scanName, processingName]) {
    const matching = result.documents.filter((document) => document.versions[0]?.fileName === name);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ taskId: null, visibility: "shared" });
    expect(matching[0]?.versions).toHaveLength(1);
  }
  const tasksAfter = await workflowApi<TasksView>(page, "GET", `${base}/tasks`);
  expect(
    tasksAfter.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision })),
  ).toEqual(
    tasksBefore.tasks.map(({ id, state, evidenceRevision }) => ({ id, state, evidenceRevision })),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
