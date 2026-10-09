import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { ClosingView, DocumentsView } from "@keycade/contracts";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { type BrowserContext, expect as baseExpect, type Page, test } from "@playwright/test";
import { prepareReview, workflowApi } from "./closing-helpers";
import { confirmHostedInboxMessage, paceHostedRequests } from "./hosted-helpers";
import {
  fillSignInEmail,
  messages,
  openLink,
  requestAccessEmail,
  waitForLink,
} from "./identity-helpers";

const env = readEnvironment();
const borrower = env.KEYCADE_E2E_BORROWER_ORIGIN ?? `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = env.KEYCADE_E2E_STAFF_ORIGIN ?? `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const hosted = env.KEYCADE_E2E_HOSTED === "true";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 25000 });
test.setTimeout(hosted ? 900000 : 420000);
const expect = baseExpect.configure({ timeout: hosted ? 30000 : 15000 });
async function signIn(page: Page, origin: string, email?: string) {
  await page.goto(origin);
  await fillSignInEmail(
    page,
    email ?? (origin === staff ? "officer-a@example.test" : "borrower@example.test"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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

test("approved terms progress through two signatures and explicit funding into one scoped account", async ({
  page,
  browser,
}, testInfo) => {
  let nextRequestAt = 0;
  const pace = async (context: BrowserContext) => {
    if (hosted) return paceHostedRequests(context);
    await context.route("**/api/**", async (route) => {
      if (!route.request().url().includes("/api/v1/auth/session")) {
        const startAt = Math.max(Date.now(), nextRequestAt);
        nextRequestAt = startAt + 800;
        await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
      }
      try {
        await route.continue();
      } catch {
        /* An inactive page may cancel a queued poll while navigation parks it. */
      }
    });
  };
  await pace(page.context());
  const primaryEmail = hosted
    ? `hosted-closing-${randomUUID()}@example.test`
    : "borrower@example.test";
  if (hosted) {
    await page.goto(`${borrower}/?bank=bank-a`);
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
    await requestAccessEmail(page, primaryEmail);
    await fillSignInEmail(page, primaryEmail);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await confirmHostedInboxMessage(page, "Your Keycade sign-in link");
    await expect(
      page.getByRole("heading", { name: "Your applications", exact: true }),
    ).toBeVisible();
  } else await signIn(page, borrower);
  await page.goto(`${borrower}/api/ready`);
  const officerContext = await browser.newContext({ viewport: page.viewportSize() });
  const signerContext = await browser.newContext({ viewport: page.viewportSize() });
  await pace(officerContext);
  await pace(signerContext);
  try {
    const officer = await officerContext.newPage();
    await signIn(officer, staff);
    await officer.goto(`${staff}/api/ready`);
    const app = await prepareReview(page, officer, { checkTimeoutMs: hosted ? 120000 : 30000 });
    testInfo.annotations.push({ type: "synthetic_application", description: app.id });
    if (hosted)
      console.log("Hosted closing: synthetic application is ready for explicit staff approval.");
    const base = `/applications/${app.id}`;
    const url = (origin: string, section: string) => `${origin}${base}/${section}?bank=bank-a`;
    await officer.goto(url(staff, "review"));
    await officer.getByRole("button", { name: "Approve application", exact: true }).click();
    await officer.getByLabel("Approved amount (USD)", { exact: true }).fill("19000.25");
    await officer
      .getByLabel("Reason shared with the applicant", { exact: true })
      .selectOption("demo_criteria_met");
    await officer
      .getByLabel(
        "I reviewed the current application and am deliberately recording this decision.",
        { exact: true },
      )
      .check();
    await officer.getByRole("button", { name: "Record approval", exact: true }).click();
    await expect(
      officer.getByRole("heading", { name: "Approval recorded", exact: true }),
    ).toBeVisible();
    await officer.getByRole("link", { name: "View closing requirements", exact: true }).click();
    await expect(officer.getByRole("article", { name: /^Funded account / })).toHaveCount(0);
    await officer.getByRole("button", { name: "Start closing", exact: true }).click();
    await expect(
      officer.getByRole("heading", { name: "Closing conditions", exact: true }),
    ).toBeVisible();
    const initial = await workflowApi<ClosingView>(officer, "GET", `${base}/closing`);
    const signature = initial.conditions.find((condition) => condition.kind === "signature");
    const acknowledgement = initial.conditions.find((condition) => condition.kind === "task");
    if (!signature || !acknowledgement)
      throw new Error("Required synthetic closing conditions missing.");
    expect(initial.account).toBeNull();
    expect(initial.capabilities.recordFunding).toBe(false);
    await expect(
      officer.getByRole("button", { name: "Record funding", exact: true }),
    ).toBeDisabled();
    // A forged early funding command is rejected by the same backend guard.
    const earlyStatus = await officer.evaluate(
      async ({ base, revision, key, date }) => {
        const session = await (await fetch("/api/v1/auth/session")).json();
        return (
          await fetch(`/api/v1/banks/${session.bank.id}${base}/closing/fund`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
            body: JSON.stringify({
              expectedRevision: revision,
              idempotencyKey: key,
              fundedAmount: "19000.25",
              fundedOn: date,
              reference: "DEMO-EARLY-REJECTED",
              humanFundingConfirmed: true,
            }),
          })
        ).status;
      },
      {
        base,
        revision: initial.revision,
        key: randomUUID(),
        date: new Date().toISOString().slice(0, 10),
      },
    );
    expect(earlyStatus).toBe(409);
    expect((await workflowApi<ClosingView>(officer, "GET", `${base}/closing`)).account).toBeNull();
    await officer.screenshot({
      path: testInfo.outputPath("synthetic-closing-blockers.png"),
      fullPage: true,
    });

    await officer.goto(url(staff, "documents"));
    await officer.getByLabel("Attach to", { exact: true }).selectOption(signature.taskId);
    const fileName = `synthetic-closing-${randomUUID().slice(0, 8)}.pdf`;
    await officer.getByLabel("Choose document files", { exact: true }).setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticDocumentPdf("clean-tax")),
    });
    const document = officer.getByRole("listitem", { name: `Document ${fileName}`, exact: true });
    await expect(document.getByRole("button", { name: "Download", exact: true })).toBeVisible({
      timeout: hosted ? 120000 : 25000,
    });
    const documents = await workflowApi<DocumentsView>(officer, "GET", `${base}/documents`);
    const source = documents.documents.find((document) =>
      document.versions.some((version) => version.fileName === fileName),
    );
    if (!source?.currentVersionId) throw new Error("Clean synthetic closing source missing.");
    const email = `closing-signer-${randomUUID()}@example.test`;
    const previous = new Set(hosted ? [] : (await messages()).map((message) => message.ID));
    await workflowApi(officer, "POST", `${base}/participants/invitations`, {
      idempotencyKey: randomUUID(),
      email,
      role: "adviser",
      scope: "assigned",
      taskIds: [signature.taskId],
      documentIds: [source.id],
    });
    const signer = await signerContext.newPage();
    if (hosted) {
      await officer.goto(`${staff}/api/ready`);
      await signIn(signer, borrower, email);
      await signer.getByRole("link", { name: "Inbox", exact: true }).click();
      await confirmHostedInboxMessage(signer, "Your application invitation");
    } else {
      await openLink(signer, await waitForLink(borrower, email, previous));
      await signer.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    }
    await signer.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(signer.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await signer.goto("about:blank");
    await officer.goto(url(staff, "signatures"));
    await officer.getByLabel("Signature task", { exact: true }).selectOption(signature.taskId);
    await officer
      .getByLabel("Current document", { exact: true })
      .selectOption(source.currentVersionId);
    await officer.getByLabel(new RegExp(primaryEmail.replaceAll(".", "\\."))).check();
    await officer.getByLabel(new RegExp(email.replaceAll(".", "\\."))).check();
    await officer.getByRole("button", { name: "Create request", exact: true }).click();
    const envelope = officer.getByRole("region", {
      name: "Signature request Sign closing agreement",
      exact: true,
    });
    await envelope.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(envelope.getByText("Delivered", { exact: true })).toBeVisible({
      timeout: hosted ? 120000 : 25000,
    });
    await officer.goto(`${staff}/api/ready`);
    await page.goto(url(borrower, "signatures"));
    const primary = page.getByRole("region", {
      name: "Signature request Sign closing agreement",
      exact: true,
    });
    await primary.getByLabel("I have reviewed the document and am ready to sign.").check();
    await primary.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(primary.getByText("Partially signed", { exact: true })).toBeVisible();
    expect(
      (await workflowApi<ClosingView>(officer, "GET", `${base}/closing`)).capabilities
        .recordFunding,
    ).toBe(false);
    await page.goto(`${borrower}/api/ready`);
    await signer.goto(url(borrower, "signatures"));
    const invited = signer.getByRole("region", {
      name: "Signature request Sign closing agreement",
      exact: true,
    });
    await invited.getByLabel("I have reviewed the document and am ready to sign.").check();
    await invited.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(invited.getByText("Completed", { exact: true })).toBeVisible();
    if (hosted)
      console.log("Hosted closing: both intended signers completed the current closing agreement.");
    await signer.goto("about:blank");

    if (hosted) await page.goto(url(borrower, "closing"));
    else {
      await page.goto(`${borrower}${base}?bank=bank-a`);
      await page.getByRole("link", { name: "View closing requirements", exact: true }).click();
      await expect(page).toHaveURL(url(borrower, "closing"));
    }
    const condition = page.getByRole("listitem", {
      name: "Closing condition Confirm funding readiness",
      exact: true,
    });
    await condition.getByRole("link", { name: "View task", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm funding readiness", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    // A condition link selects details from the upfront task snapshot.
    await expect(page.locator('[id^="task-answer-"]')).toBeVisible();
    await page
      .locator('[id^="task-answer-"]')
      .fill("I confirm the fictional closing details for this simulation.");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await page.getByRole("button", { name: "Complete task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task completed." })).toBeVisible();
    await page.goto(`${borrower}/api/ready`);
    await officer.goto(url(staff, "closing"));
    await officer
      .getByRole("listitem", { name: "Closing condition Confirm funding readiness", exact: true })
      .getByRole("link", { name: "View task", exact: true })
      .click();
    await officer
      .getByLabel("Review or waiver reason", { exact: true })
      .fill("Reviewed the fictional closing acknowledgement.");
    await officer.getByRole("button", { name: "Mark reviewed", exact: true }).click();
    await expect(
      officer.getByRole("status").filter({ hasText: "Task marked reviewed." }),
    ).toBeVisible();
    await officer.goto(url(staff, "closing"));
    const amount = officer.getByLabel("Recorded funded amount (USD)", { exact: true });
    await expect(amount).toHaveValue("19000.25");
    await expect(amount).toHaveAttribute("readonly", "");
    const reference = `DEMO-FUNDING-${randomUUID().slice(0, 8)}`;
    await officer.getByLabel("Funding reference", { exact: true }).fill(reference);
    await expect(
      officer.getByRole("button", { name: "Record funding", exact: true }),
    ).toBeDisabled();
    await officer
      .getByLabel(
        "I confirm the closing requirements were reviewed and the funding details are correct.",
        { exact: true },
      )
      .check();
    await expect(
      officer.getByRole("button", { name: "Record funding", exact: true }),
    ).toBeEnabled();
    const fundingRequest = officer.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith(`${base}/closing/fund`),
    );
    await officer.getByRole("button", { name: "Record funding", exact: true }).click();
    const command = (await fundingRequest).postDataJSON() as object;
    await expect(
      officer.getByRole("heading", { name: "Completed closing", exact: true }),
    ).toBeVisible();
    const funded = await workflowApi<ClosingView>(officer, "GET", `${base}/closing`);
    expect(funded.account).not.toBeNull();
    if (funded.account)
      testInfo.annotations.push({
        type: "synthetic_funded_account",
        description: funded.account.id,
      });
    const replay = await workflowApi<ClosingView>(officer, "POST", `${base}/closing/fund`, command);
    expect(replay.account?.id).toBe(funded.account?.id);
    expect(replay.account?.fundedAmount).toBe("19000.25");
    await expect(officer.getByRole("button", { name: "Record funding", exact: true })).toHaveCount(
      0,
    );
    if (hosted) await page.goto(url(borrower, "closing"));
    else {
      await page.goto(`${borrower}${base}?bank=bank-a`);
      await page.getByRole("link", { name: "View funded account", exact: true }).click();
      await expect(page).toHaveURL(url(borrower, "closing"));
    }
    const account = page.getByRole("article", {
      name: `Funded account ${funded.account?.id}`,
      exact: true,
    });
    await expect(account).toContainText(reference);
    await expect(account.getByText("Recorded funded amount", { exact: true })).toBeVisible();
    await expect(account.getByText("$19,000.25", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Record funding", exact: true })).toHaveCount(0);
    await noOverflow(page);
    await noOverflow(officer);
    await page.screenshot({
      path: testInfo.outputPath("synthetic-funded-account.png"),
      fullPage: true,
    });
    await officer.screenshot({
      path: testInfo.outputPath("synthetic-recorded-funding.png"),
      fullPage: true,
    });
    await officer.goto(`${staff}/api/ready`);
    await page.goto(`${borrower}/?bank=bank-a`);
    const business = page.getByRole("region", {
      name: `Funded accounts for ${app.businessName}`,
      exact: true,
    });
    await expect(business.getByRole("article")).toHaveCount(1);
    await business.getByRole("link", { name: "View funded account", exact: true }).click();
    await expect(page).toHaveURL(url(borrower, "closing"));
    await expect(account).toContainText(reference);
    await page.goto(`${borrower}/api/ready`);
    await officer.goto(`${staff}/?bank=bank-a`);
    await expect(
      officer
        .getByRole("region", { name: `Funded accounts for ${app.businessName}`, exact: true })
        .getByRole("article"),
    ).toHaveCount(1);
    await officer.goto(`${staff}/api/ready`);
    await signer.goto(`${borrower}/?bank=bank-a`);
    await expect(
      signer.getByText("No funded accounts are available for your account yet.", { exact: true }),
    ).toBeVisible();
    await expect(
      signer.getByRole("region", { name: "Funded accounts", exact: true }).getByRole("article"),
    ).toHaveCount(0);
    await signer.goto(url(borrower, "closing"));
    await expect(
      signer.getByText("This application is unavailable for your account.", { exact: true }),
    ).toBeVisible();
    await expect(signer.getByRole("article", { name: /^Funded account / })).toHaveCount(0);
    if (hosted) {
      console.log(
        "Hosted closing: funding replay returned one account; applicant/staff summaries and assigned-signer denial passed.",
      );
      await signer.goto("about:blank");
      await page.goto(url(borrower, "activity"));
      const activity = page.getByRole("region", { name: "Application activity", exact: true });
      await expect(activity.getByText("Funding recorded", { exact: true })).toBeVisible();
      await expect(activity.getByText("Support reference", { exact: true })).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath("hosted-funded-activity.png"),
        fullPage: true,
      });
      await page.goto(`${borrower}/api/ready`);
      await officer.goto(url(staff, "operations"));
      const operations = officer.getByRole("region", {
        name: "Background operations",
        exact: true,
      });
      await expect(operations.getByText("Responding", { exact: true })).toBeVisible();
      expect(await operations.getByRole("listitem").count()).toBeGreaterThan(0);
      await noOverflow(officer);
      await officer.screenshot({
        path: testInfo.outputPath("hosted-funded-operations.png"),
        fullPage: true,
      });
      console.log(
        "Hosted closing: scoped funding activity and staff background operations are visible.",
      );
    }
  } finally {
    await officerContext.close();
    await signerContext.close();
  }
});
