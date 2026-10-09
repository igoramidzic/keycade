import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import type { DocumentsView, ParticipantsWorkspace, TasksView, TaskView } from "@keycade/contracts";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { type BrowserContext, expect as baseExpect, type Page, test } from "@playwright/test";
import { workflowApi } from "./closing-helpers";
import { fillSignInEmail, messages, openLink, waitForLink } from "./identity-helpers";
import { participantCard, removeAccess } from "./participant-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const expect = baseExpect.configure({ timeout: 15000 });
const pdf = Buffer.from(syntheticDocumentPdf("clean-statement"));
// Invitations contain bearer credentials. Capture only deliberate synthetic workspace images.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 20000 });
test.setTimeout(300000);

async function status(page: Page, suffix: string) {
  return page.evaluate(async (suffix) => {
    const session = await (await fetch("/api/v1/auth/session")).json();
    if (!session.authenticated) throw new Error("Expected an active synthetic browser session.");
    const response = await fetch(`/api/v1/banks/${session.bank.id}${suffix}`);
    await response.body?.cancel();
    return response.status;
  }, suffix);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("an invited adviser uploads assigned evidence without private access and loses access in the same session when revoked", async ({
  page: officer,
  browser,
}, testInfo) => {
  let nextRequestAt = 0;
  async function pace(context: BrowserContext) {
    await context.route("**/api/**", async (route) => {
      if (!route.request().url().includes("/api/v1/auth/session")) {
        const startAt = Math.max(Date.now(), nextRequestAt);
        nextRequestAt = startAt + 800;
        await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
      }
      await route.continue().catch(() => undefined);
    });
  }
  await pace(officer.context());
  await officer.goto(staff);
  await fillSignInEmail(officer, "officer-a@example.test");
  await officer.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(officer.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
  await officer.goto(`${staff}/api/ready`);
  const applicationId =
    testInfo.project.name === "desktop"
      ? "60000000-0000-4000-8000-000000000001"
      : "60000000-0000-4000-8000-000000000002";
  const base = `/applications/${applicationId}`;
  const url = (origin: string, section: string, taskId?: string) =>
    `${origin}${base}/${section}?bank=bank-a${taskId ? `&task=${taskId}` : ""}`;
  const people = await workflowApi<ParticipantsWorkspace>(officer, "GET", `${base}/participants`);
  const applicant = people.participants.find((person) => person.email === "borrower@example.test");
  if (!applicant) throw new Error("Synthetic applicant is missing.");
  await workflowApi(officer, "POST", `${base}/participants/relationships`, {
    idempotencyKey: randomUUID(),
    displayName: `Synthetic private owner ${randomUUID().slice(0, 8)}`,
    kind: "owner",
    userId: applicant.userId,
    ownershipPercent: "10",
  });
  const tasks = await workflowApi<TasksView>(officer, "GET", `${base}/tasks`);
  const privateTask = tasks.tasks.find(
    (task) =>
      task.visibility === "private" &&
      task.subjectUserId === applicant.userId &&
      task.inputKind === "answer",
  );
  if (!privateTask) throw new Error("Synthetic private owner task is missing.");
  const privateName = `synthetic-private-owner-${randomUUID().slice(0, 8)}.pdf`;
  await officer.goto(url(staff, "tasks", privateTask.id));
  await officer.getByLabel("Choose document files", { exact: true }).setInputFiles({
    name: privateName,
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(
    officer.getByRole("listitem", { name: `Document ${privateName}`, exact: true }),
  ).toContainText("Scan clean", { timeout: 30000 });
  await officer.goto(`${staff}/api/ready`);
  const privateDocument = (
    await workflowApi<DocumentsView>(officer, "GET", `${base}/documents`)
  ).documents.find((document) => document.taskId === privateTask.id);
  if (!privateDocument?.currentVersionId) throw new Error("Synthetic private evidence is missing.");
  expect(privateDocument).toMatchObject({ visibility: "private", subjectUserId: applicant.userId });
  const assignedTitle = `Provide adviser evidence ${randomUUID().slice(0, 8)}`;
  const created = await workflowApi<TasksView>(officer, "POST", `${base}/tasks`, {
    idempotencyKey: randomUUID(),
    title: assignedTitle,
    description: "Upload the fictional adviser statement for this assigned task.",
    stage: "submission",
    required: true,
    visibility: "assigned",
  });
  let assigned = created.tasks.find((task) => task.title === assignedTitle);
  if (!assigned) throw new Error("Assigned synthetic adviser task is missing.");
  const email = `upload-adviser-${randomUUID()}@example.test`;
  const previous = new Set((await messages()).map((message) => message.ID));
  await workflowApi(officer, "POST", `${base}/participants/invitations`, {
    idempotencyKey: randomUUID(),
    email,
    role: "adviser",
    scope: "assigned",
    taskIds: [assigned.id],
    documentIds: [],
  });
  const recipientContext = await browser.newContext({ viewport: officer.viewportSize() });
  await pace(recipientContext);
  try {
    const adviser = await recipientContext.newPage();
    await openLink(adviser, await waitForLink(borrower, email, previous));
    await adviser.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await expect(
      adviser.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toBeVisible();
    expect(await status(adviser, base)).toBe(404);
    await adviser.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(adviser).toHaveURL((value) => value.pathname === base);
    await adviser.goto(`${borrower}/api/ready`);
    const accepted = (
      await workflowApi<ParticipantsWorkspace>(officer, "GET", `${base}/participants`)
    ).participants.find((person) => person.email === email);
    if (!accepted) throw new Error("Accepted synthetic adviser is missing.");
    expect(accepted).toMatchObject({ role: "adviser", scope: "assigned", status: "active" });
    assigned = await workflowApi<TaskView>(
      officer,
      "PATCH",
      `${base}/tasks/${assigned.id}/assignment`,
      {
        expectedRevision: assigned.revision,
        participantId: accepted.id,
      },
    );
    const visible = await workflowApi<TasksView>(adviser, "GET", `${base}/tasks`);
    expect(visible.tasks.map((task) => task.id)).toEqual([assigned.id]);
    expect(visible.tasks[0]?.assigneeParticipantId).toBe(accepted.id);
    const generalDocuments = await workflowApi<DocumentsView>(adviser, "GET", `${base}/documents`);
    expect(generalDocuments.canUpload).toBe(false);
    expect(generalDocuments.uploadTasks.map((task) => task.id)).toEqual([assigned.id]);
    const genericUploadKey = randomUUID();
    const genericUpload = await workflowApi<{
      uploads: { idempotencyKey: string; error?: string; uploadId?: string }[];
    }>(adviser, "POST", `${base}/documents/uploads`, {
      files: [
        {
          idempotencyKey: genericUploadKey,
          fileName: "synthetic-denied-general.pdf",
          mimeType: "application/pdf",
          expectedSize: pdf.length,
        },
      ],
    });
    expect(genericUpload.uploads).toEqual([
      { idempotencyKey: genericUploadKey, error: expect.any(String) },
    ]);
    const privateContent = `${base}/documents/versions/${privateDocument.currentVersionId}/content`;
    expect(await status(adviser, `${base}/tasks/${privateTask.id}`)).toBe(404);
    expect(await status(adviser, privateContent)).toBe(404);
    await adviser.goto(`${borrower}/applications/60000000-0000-4000-8000-000000000003?bank=bank-a`);
    await expect(adviser.getByRole("alert")).toContainText("unavailable");
    await adviser.goto(url(borrower, "tasks", assigned.id));
    await expect(
      adviser.getByRole("heading", { name: "Task documents", exact: true }),
    ).toBeVisible();
    await expect(adviser.getByText(privateName, { exact: true })).toHaveCount(0);
    await expect(
      adviser
        .getByRole("region", { name: "Your tasks", exact: true })
        .getByRole("button", { name: assigned.title, exact: true }),
    ).toBeVisible();
    const sidebar = adviser.getByRole("complementary", {
      name: "Application details",
      exact: true,
    });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Choose files", exact: true })).toHaveCount(0);
    await expect(
      sidebar.getByRole("region", { name: "Other document upload drop area", exact: true }),
    ).toHaveCount(0);
    await expect(adviser.getByRole("button", { name: privateTask.title, exact: true })).toHaveCount(
      0,
    );
    await expect(adviser.getByText("$10,000", { exact: true })).toHaveCount(0);
    await expect(adviser.getByText("$5,000,000", { exact: true })).toHaveCount(0);
    const fileName = `synthetic-adviser-statement-${randomUUID().slice(0, 8)}.pdf`;
    const picker = adviser.waitForEvent("filechooser");
    await adviser.getByRole("button", { name: "Choose files", exact: true }).focus();
    await adviser.keyboard.press("Enter");
    await (await picker).setFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
    const evidence = adviser.getByRole("listitem", { name: `Document ${fileName}`, exact: true });
    await expect(evidence).toContainText("Scan clean", { timeout: 30000 });
    await expect(evidence).toContainText(assigned.title);
    const scopedDocuments = await workflowApi<DocumentsView>(adviser, "GET", `${base}/documents`);
    expect(scopedDocuments.documents.map((document) => document.taskId)).toEqual([assigned.id]);
    const uploaded = scopedDocuments.documents[0];
    if (!uploaded?.currentVersionId) throw new Error("Uploaded adviser evidence is missing.");
    expect(uploaded.visibility).toBe("assigned");
    await noOverflow(adviser);
    await adviser.screenshot({
      path: testInfo.outputPath("synthetic-adviser-upload.png"),
      fullPage: true,
    });
    await adviser.goto(`${borrower}/api/ready`);

    await officer.goto(url(staff, "tasks", assigned.id));
    const staffEvidence = officer.getByRole("listitem", {
      name: `Document ${fileName}`,
      exact: true,
    });
    await expect(staffEvidence).toContainText("Scan clean");
    await expect(staffEvidence).toContainText(assigned.title);
    const downloading = officer.waitForEvent("download");
    await staffEvidence.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(fileName);
    const downloaded = await download.path();
    if (!downloaded) throw new Error("Expected a downloaded synthetic document.");
    expect(await readFile(downloaded)).toEqual(pdf);
    await noOverflow(officer);
    await officer.screenshot({
      path: testInfo.outputPath("synthetic-staff-adviser-evidence.png"),
      fullPage: true,
    });

    await officer.goto(url(staff, "participants"));
    const participant = participantCard(officer, email);
    // Finish the officer's paced workspace load before queuing the borrower's reads.
    await expect(participant).toBeVisible();
    testInfo.annotations.push({
      type: "reload_pacing_backlog_ms",
      description: String(Math.max(0, nextRequestAt - Date.now())),
    });
    const reloadedDocuments = adviser.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith(`${base}/documents`),
    );
    await adviser.goto(url(borrower, "tasks", assigned.id));
    expect((await reloadedDocuments).status()).toBe(200);
    await expect(
      adviser.getByRole("listitem", { name: `Document ${fileName}`, exact: true }),
    ).toBeVisible();
    await removeAccess(officer, email);
    await expect(
      officer.getByRole("status").filter({ hasText: "Participant access removed." }),
    ).toBeVisible();
    await officer.goto(`${staff}/api/ready`);
    // The session remains authenticated: current participation, not sign-out, removes access.
    expect(
      await status(adviser, `${base}/documents/versions/${uploaded.currentVersionId}/content`),
    ).toBe(404);
    expect(await status(adviser, `${base}/tasks/${assigned.id}`)).toBe(404);
    await expect(adviser.getByRole("alert").filter({ hasText: "unavailable" }).first()).toBeVisible(
      { timeout: 30000 },
    );
    await expect(
      adviser.getByRole("listitem", { name: `Document ${fileName}`, exact: true }),
    ).toHaveCount(0);
    await expect(adviser.getByRole("button", { name: "Choose files", exact: true })).toHaveCount(0);
    await adviser.reload();
    await expect(adviser.getByRole("alert")).toContainText("unavailable");
    await noOverflow(adviser);
    await adviser.screenshot({
      path: testInfo.outputPath("synthetic-adviser-access-revoked.png"),
      fullPage: true,
    });
  } finally {
    await recipientContext.close();
  }
});
