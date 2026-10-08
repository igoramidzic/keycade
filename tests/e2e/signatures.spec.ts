import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { type BrowserContext, expect as baseExpect, type Page, test } from "@playwright/test";
import { messages, openLink, waitForLink } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.setTimeout(150000);
const url = (origin: string, section: string) =>
  `${origin}/applications/${applicationId}/${section}?bank=bank-a`;
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
async function api<T>(page: Page, suffix: string, body?: object): Promise<T> {
  return page.evaluate(
    async ({ suffix, body, applicationId }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const response = await fetch(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}${suffix}`,
        {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) throw new Error(`Synthetic signature fixture failed (${response.status}).`);
      return response.json();
    },
    { suffix, body, applicationId },
  );
}
async function fixture(page: Page) {
  const title = `Synthetic agreement ${randomUUID().slice(0, 8)}`;
  const tasks = await api<{ tasks: { id: string; title: string }[] }>(page, "/tasks", {
    title,
    description: "Fictional agreement for a simulated signature workflow.",
    stage: "closing",
    required: true,
    visibility: "shared",
    idempotencyKey: randomUUID(),
  });
  const taskId = tasks.tasks.find((task) => task.title === title)?.id;
  if (!taskId) throw new Error("Expected synthetic task.");
  await page.goto(url(staff, "documents"));
  await page.getByLabel("Attach to", { exact: true }).selectOption(taskId);
  const fileName = `synthetic-agreement-${randomUUID().slice(0, 8)}.pdf`;
  await page
    .getByRole("region", { name: "Document upload drop area", exact: true })
    .getByLabel("Choose document files", { exact: true })
    .setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("clean-tax")),
    });
  const document = page.getByRole("listitem", { name: `Document ${fileName}`, exact: true });
  await expect(document.getByRole("button", { name: "Download", exact: true })).toBeVisible({
    timeout: 25000,
  });
  const documents = await api<{
    documents: { id: string; currentVersionId: string; versions: { fileName: string }[] }[];
  }>(page, "/documents");
  const source = documents.documents.find((document) =>
    document.versions.some((version) => version.fileName === fileName),
  );
  if (!source) throw new Error("Expected clean synthetic source.");
  return {
    title,
    taskId,
    fileName,
    sourceVersionId: source.currentVersionId,
    documentId: source.id,
  };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("two intended signers complete a simulated request through emailed continuation and retain a synthetic artifact", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  let nextRequestAt = 0;
  async function pace(context: BrowserContext) {
    // Three signed-in browsers share the unchanged application IP request budget.
    await context.route("**/api/**", async (route) => {
      if (!route.request().url().includes("/api/v1/auth/session")) {
        const startAt = Math.max(Date.now(), nextRequestAt);
        nextRequestAt = startAt + 800;
        await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
      }
      await route.continue().catch(() => undefined);
    });
  }
  await pace(page.context());
  await signIn(page, staff, "officer-a@example.test");
  const source = await fixture(page);
  const email = `signature-browser-${randomUUID()}@example.test`;
  const previous = new Set((await messages()).map((message) => message.ID));
  await api(page, "/participants/invitations", {
    idempotencyKey: randomUUID(),
    email,
    role: "adviser",
    scope: "assigned",
    taskIds: [source.taskId],
    documentIds: [source.documentId],
  });
  const signerContext = await browser.newContext({ viewport: page.viewportSize() });
  const applicantContext = await browser.newContext({ viewport: page.viewportSize() });
  await pace(signerContext);
  await pace(applicantContext);
  try {
    const signer = await signerContext.newPage();
    await openLink(signer, await waitForLink(borrower, email, previous));
    await signer.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await signer.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(signer.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await signer.goto("about:blank");
    await page.goto(url(staff, "signatures"));
    await page.getByLabel("Signature task", { exact: true }).selectOption(source.taskId);
    await page.getByLabel("Current document", { exact: true }).selectOption(source.sourceVersionId);
    await page.getByLabel(/borrower@example\.test/).check();
    await page.getByLabel(new RegExp(email.replaceAll(".", "\\."))).check();
    await page.getByRole("button", { name: "Create simulated request", exact: true }).click();
    const envelope = page.getByRole("region", {
      name: `Signature request ${source.title}`,
      exact: true,
    });
    await expect(envelope.getByText("Draft", { exact: true })).toBeVisible();
    const beforeSend = new Set((await messages()).map((message) => message.ID));
    await envelope.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(envelope.getByText("Sent in demo", { exact: true })).toBeVisible({
      timeout: 25000,
    });
    await page.goto(`${staff}/api/ready`);
    const applicant = await applicantContext.newPage();
    await signIn(applicant, borrower, "borrower@example.test");
    const loadedSignatures = applicant.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname.endsWith(`/applications/${applicationId}/signatures`),
    );
    await applicant.goto(url(borrower, "signatures"));
    expect((await loadedSignatures).status()).toBe(200);
    const own = applicant.getByRole("region", {
      name: `Signature request ${source.title}`,
      exact: true,
    });
    await expect(
      own.getByRole("button", { name: "View source document", exact: true }),
    ).toBeVisible();
    const sourceDownload = applicant.waitForEvent("download");
    await own.getByRole("button", { name: "View source document", exact: true }).click();
    expect((await sourceDownload).suggestedFilename()).toBe(source.fileName);
    await expect(own.getByRole("button", { name: "Sign in demo", exact: true })).toBeDisabled();
    await own
      .getByLabel("I understand this is a simulated signature with no legal effect.")
      .check();
    await own.getByRole("button", { name: "Sign in demo", exact: true }).click();
    await expect(own.getByText("Partially signed", { exact: true })).toBeVisible();
    await expect(
      own.getByRole("button", { name: "Download simulated artifact", exact: true }),
    ).toHaveCount(0);
    await applicant.goto(`${borrower}/api/ready`);
    await openLink(signer, await waitForLink(borrower, email, beforeSend));
    await signer.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    const invited = signer.getByRole("region", {
      name: `Signature request ${source.title}`,
      exact: true,
    });
    await expect(invited).toBeVisible();
    await invited
      .getByLabel("I understand this is a simulated signature with no legal effect.")
      .check();
    await invited.getByRole("button", { name: "Sign in demo", exact: true }).click();
    await expect(invited.getByText("Completed", { exact: true })).toBeVisible();
    const download = signer.waitForEvent("download");
    await invited.getByRole("button", { name: "Download simulated artifact", exact: true }).click();
    const downloaded = await download;
    expect(downloaded.suggestedFilename()).toMatch(/^simulated-signature-.+\.txt$/);
    const artifactPath = await downloaded.path();
    if (!artifactPath) throw new Error("Expected a synthetic download.");
    expect(await readFile(artifactPath, "utf8")).toMatch(/simulated|synthetic/i);
    await applicant.goto(url(borrower, "tasks"));
    const toggle = applicant.getByRole("button", { name: source.title, exact: true });
    await toggle.click();
    await expect(
      applicant.getByRole("link", { name: "View simulated signature request", exact: true }),
    ).toBeVisible();
    await expect(applicant.getByLabel("Your answer", { exact: true })).toHaveCount(0);
    const statusId = await toggle.getAttribute("aria-describedby");
    await expect(applicant.locator(`[id="${statusId}"]`)).toContainText("Completed");
    await noOverflow(signer);
    await noOverflow(page);
    await signer.screenshot({
      path: testInfo.outputPath("synthetic-signed-request.png"),
      fullPage: true,
    });
    await page.goto(url(staff, "documents"));
    const saved = page.getByRole("listitem", { name: `Document ${source.fileName}`, exact: true });
    const replacement = page.waitForEvent("filechooser");
    await saved.getByRole("button", { name: "Upload replacement", exact: true }).click();
    await (await replacement).setFiles({
      name: `new-${source.fileName}`,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("clean-statement")),
    });
    await expect(
      page.getByRole("listitem", { name: `Document new-${source.fileName}`, exact: true }),
    ).toBeVisible();
    await page.goto(url(staff, "signatures"));
    await expect(envelope.getByText("Outdated source", { exact: true })).toBeVisible();
    await expect(envelope).toContainText("staff must create a new request");
  } finally {
    await signerContext.close();
    await applicantContext.close();
  }
});

test("failed send, retry, void, decline, and expiry are explicit simulated states", async ({
  page,
  browser,
}) => {
  await signIn(page, staff, "officer-a@example.test");
  const source = await fixture(page);
  const people = await api<{ participants: { id: string; email: string }[] }>(
    page,
    "/participants",
  );
  const signerId = people.participants.find(
    (person) => person.email === "borrower@example.test",
  )?.id;
  if (!signerId) throw new Error("Expected primary synthetic signer.");
  const create = (scenario: string, expiresAt?: string) =>
    api<{ envelopes: { id: string; taskTitle: string }[] }>(page, "/signatures", {
      taskId: source.taskId,
      sourceVersionId: source.sourceVersionId,
      signerParticipantIds: [signerId],
      idempotencyKey: randomUUID(),
      scenario,
      ...(expiresAt ? { expiresAt } : {}),
    });
  const failed = (await create("terminal_error")).envelopes[0];
  if (!failed) throw new Error("Expected envelope.");
  await page.goto(url(staff, "signatures"));
  const failedRequest = page.locator(`#envelope-${failed.id}`);
  await failedRequest.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(failedRequest.getByText("Send failed", { exact: true })).toBeVisible({
    timeout: 25000,
  });
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/signatures/${failed.id}/send`) &&
      response.request().method() === "POST",
  );
  await failedRequest.getByRole("button", { name: "Retry sending", exact: true }).click();
  const retried = await (await retryResponse).json();
  expect(
    retried.envelopes.find((envelope: { id: string }) => envelope.id === failed.id).deliveryStatus,
  ).toBe("pending");
  await expect(failedRequest.getByText("Send failed", { exact: true })).toBeVisible({
    timeout: 25000,
  });
  await failedRequest.getByRole("button", { name: "Void request", exact: true }).click();
  await expect(failedRequest.getByText("Voided", { exact: true })).toBeVisible();
  const decline = (await create("success")).envelopes[0];
  if (!decline) throw new Error("Expected envelope.");
  await api(page, `/signatures/${decline.id}/send`, {});
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const signer = await context.newPage();
    await signIn(signer, borrower, "borrower@example.test");
    await signer.goto(url(borrower, "signatures"));
    const request = signer.locator(`#envelope-${decline.id}`);
    await expect(request.getByRole("button", { name: "Decline request", exact: true })).toBeVisible(
      { timeout: 25000 },
    );
    await request.getByRole("button", { name: "Decline request", exact: true }).click();
    await expect(request.getByText("Declined", { exact: true }).first()).toBeVisible();
    await expect(request.getByRole("button", { name: "Sign in demo", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
  const expires = (await create("success", new Date(Date.now() + 2000).toISOString())).envelopes[0];
  if (!expires) throw new Error("Expected envelope.");
  await page.reload();
  await expect(
    page.locator(`#envelope-${expires.id}`).getByText("Expired", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await noOverflow(page);
});
