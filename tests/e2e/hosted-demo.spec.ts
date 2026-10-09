import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readEnvironment } from "@keycade/config/server";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { paceHostedRequests } from "./hosted-helpers";
import { completeAddressAndSkipOptional } from "./setup-helpers";

const env = readEnvironment();
const borrower = env.KEYCADE_E2E_BORROWER_ORIGIN ?? "";
const staff = env.KEYCADE_E2E_STAFF_ORIGIN ?? "";
test.skip(env.KEYCADE_E2E_HOSTED !== "true", "Explicit hosted acceptance is required.");
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 25_000 });
test.setTimeout(600_000);

async function api<T>(
  page: Page,
  applicationId: string,
  suffix: string,
  body?: object,
): Promise<T> {
  return page.evaluate(
    async ({ applicationId, suffix, body }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      if (!session.authenticated) throw new Error("Synthetic hosted session is unavailable.");
      const response = await fetch(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}${suffix}`,
        {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          `Synthetic hosted fixture failed (${response.status}, ${error.error?.code ?? "unknown"}).`,
        );
      }
      return response.json();
    },
    { applicationId, suffix, body },
  );
}
async function requestLink(page: Page, email: string, start = false) {
  await page.goto(`${borrower}${start ? "/apply" : "/"}?bank=bank-a`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Use an email link instead", exact: true }).click();
  await page
    .getByRole("button", { name: start ? "Start application" : "Send sign-in link", exact: true })
    .click();
  await expect(page.getByText("Check your inbox", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open demo inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Demo inbox", exact: true })).toBeVisible();
}
async function confirmInboxMessage(page: Page, subject: string) {
  const item = page
    .getByRole("list", { name: "Simulated messages" })
    .getByRole("button")
    .filter({ hasText: subject })
    .filter({ hasText: "Ready" })
    .first();
  await expect(item).toBeVisible({ timeout: 120_000 });
  await item.click();
  const detail = page.getByRole("region", { name: "Selected simulated message" });
  expect(await detail.evaluate((node) => !/#token=[a-f0-9]{64}/.test(node.textContent ?? ""))).toBe(
    true,
  );
  try {
    await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
  } catch {
    throw new Error("Could not open the hosted synthetic confirmation.");
  }
  await expect(page.getByText("Confirm your sign-in", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash === "")).toBe(true);
  await page.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
}
async function demoSignIn(page: Page, origin: string, email: string) {
  await page.goto(`${origin}/?bank=bank-a`);
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

test("hosted synthetic borrower resumes setup, invites a scoped collaborator, and completes two-party signing", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await paceHostedRequests(context);
  const nonce = randomUUID().slice(0, 8);
  const applicantEmail = `hosted-applicant-${nonce}@example.test`;
  const adviserEmail = `hosted-adviser-${nonce}@example.test`;
  const title = `Synthetic hosted agreement ${nonce}`;
  const fileName = `synthetic-hosted-agreement-${nonce}.pdf`;
  await requestLink(page, applicantEmail, true);
  await confirmInboxMessage(page, "Your application is started");
  await expect(page.getByLabel("Legal business name", { exact: true })).toBeVisible();
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  if (!applicationId) throw new Error("Hosted synthetic application was not created.");
  testInfo.annotations.push({ type: "synthetic_application", description: applicationId });
  const section = (origin: string, name: string) =>
    `${origin}/applications/${applicationId}/${name}?bank=bank-a`;
  await page
    .getByLabel("Legal business name", { exact: true })
    .fill(`Synthetic Hosted Workshop ${nonce}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await completeAddressAndSkipOptional(page);
  await page.getByLabel("Requested amount", { exact: true }).fill("32000");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await requestLink(page, applicantEmail);
  await confirmInboxMessage(page, "Your Keycade sign-in link");
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(
    /32,?000(?:\.00)?/,
  );
  expect(new URL(page.url()).pathname).toBe(`/applications/${applicationId}/setup/amount`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: "Equipment purchase", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  await page.goto(section(borrower, "tasks"));
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  console.log("Hosted acceptance: saved setup resumed, completed, and task portal opened.");
  await page.goto("about:blank");

  const officerContext = await browser.newContext({ viewport: page.viewportSize() });
  const adviserContext = await browser.newContext({ viewport: page.viewportSize() });
  await paceHostedRequests(officerContext);
  await paceHostedRequests(adviserContext);
  try {
    const officer = await officerContext.newPage();
    const adviser = await adviserContext.newPage();
    await demoSignIn(officer, staff, "officer-a@example.test");
    const tasks = await api<{ tasks: { id: string; title: string }[] }>(
      officer,
      applicationId,
      "/tasks",
      {
        title,
        description: "Synthetic agreement for hosted demo verification.",
        stage: "closing",
        required: true,
        visibility: "shared",
        idempotencyKey: randomUUID(),
      },
    );
    const taskId = tasks.tasks.find((task) => task.title === title)?.id;
    if (!taskId) throw new Error("Hosted synthetic signature task is missing.");
    await officer.goto(section(staff, "documents"));
    await officer.getByLabel("Attach to", { exact: true }).selectOption(taskId);
    await officer.getByLabel("Choose document files", { exact: true }).setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("clean-tax")),
    });
    const document = officer.getByRole("listitem", { name: `Document ${fileName}`, exact: true });
    await expect(document.getByRole("button", { name: "Download", exact: true })).toBeVisible({
      timeout: 120_000,
    });
    const originalDownload = officer.waitForEvent("download");
    await document.getByRole("button", { name: "Download", exact: true }).click();
    const originalPath = await (await originalDownload).path();
    if (!originalPath) throw new Error("Hosted synthetic source download is missing.");
    expect(
      (await readFile(originalPath)).equals(Buffer.from(syntheticDocumentPdf("clean-tax"))),
    ).toBe(true);
    const documents = await api<{
      documents: { id: string; currentVersionId: string; versions: { fileName: string }[] }[];
    }>(officer, applicationId, "/documents");
    const source = documents.documents.find((item) =>
      item.versions.some((version) => version.fileName === fileName),
    );
    if (!source) throw new Error("Hosted synthetic source document is missing.");
    console.log("Hosted acceptance: private synthetic PDF uploaded and scan completed.");

    await officer.goto(section(staff, "participants"));
    await officer.getByRole("button", { name: "Invite participant", exact: true }).click();
    const invite = officer.getByRole("dialog", { name: "Invite a collaborator", exact: true });
    await invite.getByLabel("Email address", { exact: true }).fill(adviserEmail);
    await invite.getByRole("radio", { name: "Adviser", exact: true }).check();
    await expect(invite).toContainText("Access: Assigned tasks and permitted documents.");
    await invite.getByRole("checkbox", { name: title, exact: true }).check();
    await invite.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(
      officer.getByRole("status").filter({ hasText: "Invitation saved." }),
    ).toBeVisible();
    await officer.goto("about:blank");
    await demoSignIn(adviser, borrower, adviserEmail);
    await adviser.getByRole("link", { name: "Demo inbox", exact: true }).click();
    await confirmInboxMessage(adviser, "Your application invitation");
    await adviser.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(adviser.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await adviser.goto("about:blank");
    await officer.goto(section(staff, "participants"));
    const scope = await api<{
      participants: { email: string; role: string; scope: string; taskIds: string[] }[];
    }>(officer, applicationId, "/participants");
    expect(scope.participants.find((person) => person.email === adviserEmail)).toMatchObject({
      role: "adviser",
      scope: "assigned",
      taskIds: [taskId],
    });
    console.log("Hosted acceptance: intended adviser confirmed and accepted assigned access.");

    await officer.goto(section(staff, "signatures"));
    await officer.getByLabel("Signature task", { exact: true }).selectOption(taskId);
    await officer
      .getByLabel("Current document", { exact: true })
      .selectOption(source.currentVersionId);
    await officer.getByLabel(new RegExp(applicantEmail.replaceAll(".", "\\."))).check();
    await officer.getByLabel(new RegExp(adviserEmail.replaceAll(".", "\\."))).check();
    await officer.getByRole("button", { name: "Create simulated request", exact: true }).click();
    const envelope = officer.getByRole("region", {
      name: `Signature request ${title}`,
      exact: true,
    });
    await envelope.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(envelope.getByText("Sent in demo", { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await officer.goto("about:blank");

    for (const signer of [page, adviser]) {
      await signer.goto(`${borrower}/demo-inbox?bank=bank-a`);
      await confirmInboxMessage(signer, "Review your simulated signature request");
      const request = signer.getByRole("region", {
        name: `Signature request ${title}`,
        exact: true,
      });
      await expect(
        request.getByRole("button", { name: "Sign in demo", exact: true }),
      ).toBeDisabled();
      await request
        .getByLabel("I understand this is a simulated signature with no legal effect.")
        .check();
      await request.getByRole("button", { name: "Sign in demo", exact: true }).click();
      await expect(
        request.getByText(signer === page ? "Partially signed" : "Completed", { exact: true }),
      ).toBeVisible();
      if (signer === page) await signer.goto("about:blank");
    }
    const signed = adviser.getByRole("region", { name: `Signature request ${title}`, exact: true });
    const download = adviser.waitForEvent("download");
    await signed.getByRole("button", { name: "Download simulated artifact", exact: true }).click();
    const artifact = await download;
    const path = await artifact.path();
    if (!path) throw new Error("Hosted synthetic artifact download is missing.");
    expect(await readFile(path, "utf8")).toContain("KEYCADE SIMULATED SIGNATURE ARTIFACT");
    await officer.goto(`${staff}/?bank=bank-a`);
    const completed = await api<{ tasks: { id: string; state: string; inputKind: string }[] }>(
      officer,
      applicationId,
      "/tasks",
    );
    expect(completed.tasks.find((task) => task.id === taskId)).toMatchObject({
      state: "completed",
      inputKind: "signature",
    });
    console.log(
      "Hosted acceptance: both intended signers completed and synthetic artifact downloaded.",
    );
    await noOverflow(adviser);
    await adviser.getByRole("link", { name: "Demo inbox", exact: true }).click();
    const used = adviser
      .getByRole("list", { name: "Simulated messages" })
      .getByRole("button")
      .filter({ hasText: "Review your simulated signature request" });
    await expect(used).toContainText("Used");
    await used.click();
    await expect(
      adviser
        .getByRole("region", { name: "Selected simulated message" })
        .getByText("This confirmation link is no longer available.", { exact: false }),
    ).toBeVisible();
    await expect(
      adviser.getByRole("button", { name: "Open confirmation", exact: true }),
    ).toHaveCount(0);
    expect(await adviser.evaluate(() => !/#token=[a-f0-9]{64}/.test(document.body.innerText))).toBe(
      true,
    );
    await adviser.screenshot({
      path: testInfo.outputPath("hosted-simulated-inbox-used.png"),
      fullPage: true,
    });
  } finally {
    await officerContext.close();
    await adviserContext.close();
  }
});
