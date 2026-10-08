import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { messages, openLink, waitForLink } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const otherApplicationId = "60000000-0000-4000-8000-000000000003";
// Emailed bearer links and session material must never enter browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

async function signIn(page: Page, origin: string, email: string, bankSlug = "bank-a") {
  await page.goto(`${origin}/?bank=${bankSlug}`);
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
async function status(page: Page, suffix = "", targetApplicationId = applicationId) {
  return page.evaluate(
    async ({ applicationId, suffix }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      if (!session.authenticated) throw new Error("Expected synthetic session.");
      return (
        await fetch(`/api/v1/banks/${session.bank.id}/applications/${applicationId}${suffix}`)
      ).status;
    },
    { applicationId: targetApplicationId, suffix },
  );
}
async function people(page: Page, targetApplicationId = applicationId) {
  return page.evaluate(async (applicationId) => {
    const session = await (await fetch("/api/v1/auth/session")).json();
    if (!session.authenticated) throw new Error("Expected synthetic session.");
    const response = await fetch(
      `/api/v1/banks/${session.bank.id}/applications/${applicationId}/participants`,
    );
    if (!response.ok) throw new Error(`Synthetic participants read failed (${response.status}).`);
    return response.json() as Promise<{
      participants: { id: string; email: string; role: string; scope: string; status: string }[];
      relationships: { displayName: string; userId: string | null }[];
      invitations: { id: string; email: string; role: string; scope: string; status: string }[];
    }>;
  }, targetApplicationId);
}

test("only the lender invites a lawyer, selects their tasks, and removes the active participant", async ({
  page,
  browser,
}, testInfo) => {
  const email = `lawyer-browser-${randomUUID()}@example.test`;
  const previous = new Set((await messages()).map((message) => message.ID));
  await signIn(page, borrower, "borrower@example.test");
  await page.goto(`${borrower}/applications/${applicationId}/people?bank=bank-a`);
  await expect(
    page.getByRole("heading", { name: "People with portal access", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invitation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend invitation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke invitation", exact: true })).toHaveCount(0);
  await expect(page.getByText("Your lender invites collaborators", { exact: false })).toBeVisible();
  await noOverflow(page);
  await signIn(page, staff, "officer-a@example.test");
  const taskTitle = `Synthetic lawyer request ${randomUUID().slice(0, 8)}`;
  await page.goto(`${staff}/applications/${applicationId}/tasks?bank=bank-a`);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill(taskTitle);
  await page.getByLabel("Instructions", { exact: true }).fill("Provide a fictional legal summary.");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  await page.goto(`${staff}/applications/${applicationId}/participants?bank=bank-a`);
  await expect(
    page.getByRole("heading", { name: "Invite a collaborator", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Role", { exact: true })).toHaveValue("adviser");
  await expect(page.getByLabel("Access scope", { exact: true })).toHaveValue("assigned");
  await page.getByRole("checkbox", { name: taskTitle, exact: true }).check();
  await expect(page.getByRole("checkbox", { name: /Describe your business/ })).not.toBeChecked();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation saved." })).toBeVisible();
  const pending = (await people(page)).invitations.find((row) => row.email === email);
  expect(pending).toMatchObject({ role: "adviser", scope: "assigned", status: "pending" });
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-lawyer-invitation.png"),
    fullPage: true,
  });
  const recipientContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const recipient = await recipientContext.newPage();
    await openLink(recipient, await waitForLink(borrower, email, previous));
    await recipient.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await expect(
      recipient.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toBeVisible();
    expect(await status(recipient)).toBe(404);
    await noOverflow(recipient);
    await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(recipient).toHaveURL((url) => url.pathname === `/applications/${applicationId}`);
    expect(await status(recipient)).toBe(200);
    await expect(recipient.getByLabel("Legal business name", { exact: true })).toHaveCount(0);
    await expect(recipient.getByRole("button", { name: taskTitle, exact: true })).toBeVisible();
    await expect(
      recipient.getByRole("button", { name: "Describe your business", exact: true }),
    ).toHaveCount(0);
    await recipient.getByRole("button", { name: taskTitle, exact: true }).click();
    await recipient
      .locator('[id^="task-answer-"]')
      .fill("Synthetic legal summary for lender review.");
    await recipient.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(recipient.getByRole("status").filter({ hasText: "Answer saved" })).toBeVisible();
    await recipient.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(recipient.getByRole("status").filter({ hasText: "Submitted" })).toBeVisible();
    await recipient.goto(`${borrower}/applications/${applicationId}/people?bank=bank-a`);
    await expect(
      recipient.getByRole("heading", { name: "Invite a collaborator", exact: true }),
    ).toHaveCount(0);
    await expect(recipient.getByLabel("Owner name", { exact: true })).toHaveCount(0);
    await noOverflow(recipient);
    await recipient.goto(`${borrower}/applications/${otherApplicationId}?bank=bank-a`);
    await expect(recipient.getByRole("alert")).toContainText("unavailable");
    await page.reload();
    const participant = page
      .getByRole("listitem")
      .filter({ hasText: email })
      .filter({ has: page.getByRole("button", { name: "Remove access", exact: true }) });
    await participant.getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Participant access removed." }),
    ).toBeVisible();
    expect(await status(recipient)).toBe(404);
    await recipient.goto(`${borrower}/applications/${applicationId}?bank=bank-a`);
    await expect(recipient.getByRole("alert")).toContainText("unavailable");
  } finally {
    await recipientContext.close();
  }
});

test("staff records an owner without an account, then grants separate owner access through the inbox", async ({
  page,
  browser,
}, testInfo) => {
  const ownerName = `Synthetic Owner ${randomUUID().slice(0, 8)}`;
  const email = `owner-browser-${randomUUID()}@example.test`;
  await signIn(page, staff, "officer-a@example.test");
  await page.goto(`${staff}/applications/${applicationId}/participants?bank=bank-a`);
  await expect(page.getByLabel("Owner name", { exact: true })).toBeVisible();
  const before = await people(page);
  await page.getByLabel("Owner name", { exact: true }).fill(ownerName);
  await page.getByLabel("Ownership percentage (optional)", { exact: true }).fill("25.50");
  await page.getByRole("button", { name: "Save owner", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Owner relationship saved." }),
  ).toBeVisible();
  const after = await people(page);
  expect(after.participants).toEqual(before.participants);
  expect(after.invitations).toEqual(before.invitations);
  expect(after.relationships.find((row) => row.displayName === ownerName)).toMatchObject({
    userId: null,
  });
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-owner-record.png"),
    fullPage: true,
  });
  const previous = new Set((await messages()).map((message) => message.ID));
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption("owner");
  await expect(page.getByLabel("Access scope", { exact: true })).toHaveValue("assigned");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation saved." })).toBeVisible();
  const recipientContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const recipient = await recipientContext.newPage();
    await openLink(recipient, await waitForLink(borrower, email, previous));
    await recipient.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await expect(
      recipient.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toBeVisible();
    await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(recipient).toHaveURL((url) => url.pathname === `/applications/${applicationId}`);
    expect(await status(recipient)).toBe(200);
    await noOverflow(recipient);
  } finally {
    await recipientContext.close();
  }
  await page.reload();
  expect((await people(page)).participants.find((row) => row.email === email)).toMatchObject({
    role: "owner",
    scope: "assigned",
    status: "active",
  });
});

test("direct invitation recovery preserves its bank and destination and rejects a verified wrong recipient", async ({
  page,
  browser,
}) => {
  const bankBApplicationId = "60000000-0000-4000-8000-000000000004";
  const email = `recovery-invite-${randomUUID()}@example.test`;
  const originalInbox = new Set((await messages()).map((message) => message.ID));
  await signIn(page, staff, "officer-b@example.test", "bank-b");
  await page.goto(`${staff}/applications/${bankBApplicationId}/participants?bank=bank-b`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation saved." })).toBeVisible();
  const invitation = (await people(page, bankBApplicationId)).invitations.find(
    (row) => row.email === email,
  );
  if (!invitation) throw new Error("Expected a synthetic invitation to recover.");
  // Wait for the original invitation, then deliberately use a newly requested sign-in email.
  await waitForLink(borrower, email, originalInbox);
  const path = `/invitations/${invitation.id}`;
  async function authenticateAtInvitation(
    recipient: Page,
    recipientEmail: string,
    url = `${borrower}${path}?bank=bank-b`,
  ) {
    const previous = new Set((await messages()).map((message) => message.ID));
    await recipient.goto(url);
    await expect(recipient.getByText("Synthetic Bank B", { exact: true }).first()).toBeVisible();
    await recipient.getByLabel("Email address", { exact: true }).fill(recipientEmail);
    await recipient.getByRole("button", { name: "Use an email link instead", exact: true }).click();
    await recipient.getByRole("button", { name: "Send sign-in link", exact: true }).click();
    await expect(recipient.getByText("Check your inbox", { exact: true })).toBeVisible();
    await openLink(recipient, await waitForLink(borrower, recipientEmail, previous));
    await recipient.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await expect(recipient).toHaveURL(
      (url) => url.pathname === path && url.searchParams.get("bank") === "bank-b",
    );
    expect(await status(recipient, "", bankBApplicationId)).toBe(404);
  }
  for (const recipientEmail of [`wrong-recipient-${randomUUID()}@example.test`, email]) {
    const recipientContext = await browser.newContext({ viewport: page.viewportSize() });
    try {
      const recipient = await recipientContext.newPage();
      await authenticateAtInvitation(recipient, recipientEmail);
      if (recipientEmail !== email) {
        await expect(recipient.getByRole("alert")).toContainText("This invitation is unavailable");
        await expect(recipient.getByRole("alert")).toContainText(
          "Sign in with the email address that received this invitation",
        );
        await expect(
          recipient.getByRole("button", { name: "Accept invitation", exact: true }),
        ).toHaveCount(0);
        expect(
          (await people(page, bankBApplicationId)).invitations.find(
            (row) => row.id === invitation.id,
          )?.status,
        ).toBe("pending");
      } else {
        await expect(
          recipient.getByRole("heading", { name: "Application invitation", exact: true }),
        ).toBeVisible();
        // A copied invitation route remains usable at its bank after signing out.
        const copiedInvitationUrl = recipient.url();
        await recipient.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(recipient.getByLabel("Email address", { exact: true })).toBeVisible();
        await authenticateAtInvitation(recipient, recipientEmail, copiedInvitationUrl);
        await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
        await expect(recipient).toHaveURL(
          (url) =>
            url.pathname === `/applications/${bankBApplicationId}` &&
            url.searchParams.get("bank") === "bank-b",
        );
        expect(await status(recipient, "", bankBApplicationId)).toBe(200);
        // Bank B participation cannot expose an application from Bank A.
        expect(await status(recipient)).toBe(404);
      }
      await noOverflow(recipient);
    } finally {
      await recipientContext.close();
    }
  }
});
