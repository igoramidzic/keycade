import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { messages, openLink, waitForLink } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const ids = {
  officer: "20000000-0000-4000-8000-000000000002",
  product: "50000000-0000-4000-8000-000000000001",
  small: "60000000-0000-4000-8000-000000000001",
  otherBank: "60000000-0000-4000-8000-000000000004",
};

// Sessions and continuation links must never be retained in browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

type Setup = {
  id: string;
  businessName: string | null;
  requestedAmount: string | null;
  purpose: string | null;
  currentStep: string;
  setupStatus: string;
  revision: number;
};

async function api<T>(page: Page, method: string, suffix: string, body?: object): Promise<T> {
  // Only safe application data leaves the browser, never session or CSRF values.
  return page.evaluate(
    async ({ method, suffix, body }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      if (!session.authenticated) throw new Error("Expected an authenticated synthetic fixture.");
      const response = await fetch(`/api/v1/banks/${session.bank.id}/applications${suffix}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(`Synthetic staff fixture failed (${response.status}).`);
      return response.json();
    },
    { method, suffix, body },
  );
}

async function signIn(page: Page, origin = staff, email = "officer-a@example.test") {
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

async function filter(page: Page, label: string, key: string, value: string) {
  await page.getByLabel(label, { exact: true }).selectOption(value);
  await expect(page).toHaveURL((url) => url.searchParams.get(key) === value);
}

const workspaceUrl = (id: string, section = "overview") =>
  `${staff}/applications/${id}/${section}?bank=bank-a`;

async function namedDraft(page: Page, name: string, email?: string) {
  const created = await api<Setup>(page, "POST", "", {
    idempotencyKey: randomUUID(),
    ...(email ? { email } : {}),
  });
  return api<Setup>(page, "PATCH", `/${created.id}/setup`, {
    expectedRevision: created.revision,
    answers: { businessName: name },
    currentStep: "business_name",
  });
}

test("staff creates and updates a prefilled draft, then the emailed borrower confirms setup", async ({
  page,
  browser,
}, testInfo) => {
  const email = `staff-workspace-${randomUUID()}@example.test`;
  const businessName = `Synthetic Staff Workshop ${randomUUID().slice(0, 8)}`;
  const note = "Synthetic internal follow-up for the assigned officer only.";
  const editedNote = "Synthetic internal follow-up updated after the staff review.";
  const previous = new Set((await messages()).map((message) => message.ID));
  await signIn(page);
  await page.getByRole("link", { name: "Create application", exact: true }).click();
  await page.getByLabel("Borrower email", { exact: true }).fill(email);
  await page.getByLabel("Business name", { exact: true }).fill(businessName);
  await page.getByLabel("Requested amount (USD)", { exact: true }).fill("7500000");
  await page.getByLabel("Purpose", { exact: true }).fill("Synthetic commercial equipment");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: businessName, exact: true })).toBeVisible();
  const applicationId = new URL(page.url()).pathname.split("/")[2];
  if (!applicationId) throw new Error("Expected the created staff workspace route.");
  expect(await api<Setup>(page, "GET", `/${applicationId}/setup`)).toMatchObject({
    businessName,
    requestedAmount: "7500000.00",
    setupStatus: "in_progress",
    currentStep: "business_name",
  });
  await expect(page.getByText("Setup incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending borrower", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /approve|decline|fund application/i })).toHaveCount(
    0,
  );
  await noOverflow(page);
  // Deliberate captures include only the fictional application, never credentials or bearer links.
  await page.screenshot({
    path: testInfo.outputPath("synthetic-staff-overview.png"),
    fullPage: true,
  });

  await page.getByLabel("Assigned officer", { exact: true }).selectOption(ids.officer);
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Assignment saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Assigned officer", { exact: true })).toHaveValue(ids.officer);
  await page.getByRole("button", { name: "Edit prefilled answers", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(businessName);
  await page.getByLabel("Purpose", { exact: true }).fill("Synthetic updated commercial equipment");
  await page.getByRole("button", { name: "Save prefilled answers", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Prefilled answers saved." }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic updated commercial equipment", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Internal notes", exact: true }).click();
  await page.getByLabel("New internal note", { exact: true }).fill(note);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Internal note added." })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel("Edit internal note", { exact: true }).fill(editedNote);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByLabel("Edit internal note", { exact: true })).toHaveCount(0);
  await expect(page.getByText(editedNote, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(editedNote, { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toHaveCount(0);
  await noOverflow(page);

  const borrowerContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const borrowerPage = await borrowerContext.newPage();
    const link = await waitForLink(borrower, email, previous);
    await openLink(borrowerPage, link);
    await borrowerPage.getByRole("button", { name: "Confirm and sign in", exact: true }).click();
    await expect(borrowerPage).toHaveURL(
      (url) => url.origin === borrower && url.pathname === `/applications/${applicationId}/setup`,
    );
    await expect(borrowerPage.getByLabel("Business name", { exact: true })).toHaveValue(
      businessName,
    );
    await borrowerPage.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(borrowerPage.getByLabel("Requested amount", { exact: true })).toHaveValue(
      /7,?500,?000(?:\.00)?/,
    );
    await borrowerPage.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(borrowerPage.getByLabel("Loan purpose", { exact: true })).toHaveValue(
      "Synthetic updated commercial equipment",
    );
    await borrowerPage.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(borrowerPage.getByLabel("Industry", { exact: true })).toBeVisible();
    await borrowerPage.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(
      borrowerPage.getByRole("heading", { name: "Review your application setup", exact: true }),
    ).toBeVisible();
    await expect(borrowerPage.getByText(businessName, { exact: true })).toBeVisible();
    await expect(
      borrowerPage.getByText("Synthetic updated commercial equipment", { exact: true }),
    ).toBeVisible();
    expect(await api<Setup>(borrowerPage, "GET", `/${applicationId}/setup`)).toMatchObject({
      setupStatus: "in_progress",
      purpose: "Synthetic updated commercial equipment",
    });
    await borrowerPage.getByRole("button", { name: "Finish setup", exact: true }).click();
    await expect(borrowerPage.getByText("Initial setup complete", { exact: true })).toBeVisible();
    await expect(
      borrowerPage.getByRole("link", { name: "Internal notes", exact: true }),
    ).toHaveCount(0);
    await expect(borrowerPage.getByText(editedNote, { exact: true })).toHaveCount(0);
    await noOverflow(borrowerPage);
  } finally {
    await borrowerContext.close();
  }
  await page.bringToFront();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.reload();
  expect((await api<Setup>(page, "GET", `/${applicationId}/setup`)).setupStatus).toBe("completed");
  await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Assigned officer", { exact: true })).toHaveValue(ids.officer);
});

test("the queue finds borrower and staff drafts together and filters without crossing banks", async ({
  page,
  browser,
}, testInfo) => {
  const prefix = `Synthetic Queue ${randomUUID().slice(0, 8)}`;
  const borrowerContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const borrowerPage = await borrowerContext.newPage();
    await signIn(borrowerPage, borrower, `staff-queue-borrower-${randomUUID()}@example.test`);
    await namedDraft(borrowerPage, `${prefix} Borrower`);
  } finally {
    await borrowerContext.close();
  }
  await signIn(page);
  await namedDraft(page, `${prefix} Staff`, `staff-queue-created-${randomUUID()}@example.test`);
  await page.reload();
  await filter(page, "Rows per page", "limit", "5");
  await expect(page.getByRole("article")).toHaveCount(5);
  const firstPageIds = await page
    .getByRole("article")
    .evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")));
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeEnabled();
  await expect
    .poll(async () => {
      const secondPageIds = await page
        .getByRole("article")
        .evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")));
      return secondPageIds.length > 0 && !secondPageIds.some((id) => firstPageIds.includes(id));
    })
    .toBe(true);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await page.getByLabel("Search applications", { exact: true }).fill(prefix);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("search") === prefix);
  await expect(page.getByRole("link", { name: `${prefix} Borrower`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `${prefix} Staff`, exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: `${prefix} Borrower` })).toContainText(
    "Borrower created",
  );
  await expect(page.getByRole("article").filter({ hasText: `${prefix} Staff` })).toContainText(
    "Staff created",
  );
  await page.screenshot({ path: testInfo.outputPath("synthetic-staff-queue.png"), fullPage: true });
  await filter(page, "Stage", "status", "draft");
  await filter(page, "Product", "productId", ids.product);
  await filter(page, "Assignee", "assigneeId", "unassigned");
  await filter(page, "Sort by", "sort", "business_asc");
  await expect(page.getByRole("link", { name: `${prefix} Borrower`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `${prefix} Staff`, exact: true })).toBeVisible();
  await filter(page, "Assignee", "assigneeId", ids.officer);
  await expect(page.getByText("No applications found", { exact: true })).toBeVisible();
  await filter(page, "Assignee", "assigneeId", "unassigned");
  await expect(page.getByRole("link", { name: `${prefix} Staff`, exact: true })).toBeVisible();
  await page.getByLabel("Search applications", { exact: true }).fill("Synthetic Birch Services");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No applications found", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await noOverflow(page);
});

test("staff workspace sections stay scoped and explain unavailable capabilities", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(workspaceUrl(ids.small));
  await expect(
    page.getByRole("heading", { name: "Synthetic Cedar Workshop", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Participants", exact: true }).click();
  await expect(page).toHaveURL(workspaceUrl(ids.small, "participants"));
  await expect(
    page.getByRole("heading", { name: "People with portal access", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("borrower@example.test", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Invite a collaborator", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save owner", exact: true })).toBeVisible();
  await expect(page.getByLabel("Role", { exact: true })).toHaveValue("adviser");
  await expect(page.getByLabel("Access scope", { exact: true })).toHaveValue("assigned");
  await noOverflow(page);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  for (const section of [
    { path: "documents", label: "Documents", empty: null },
    { path: "checks", label: "Checks", empty: "Simulated checks" },
  ]) {
    await page.getByRole("link", { name: section.label, exact: true }).click();
    await expect(page).toHaveURL(workspaceUrl(ids.small, section.path));
    if (section.empty)
      await expect(page.getByRole("heading", { name: section.empty, exact: true })).toBeVisible();
    else
      await expect(page.getByRole("region", { name: "Document upload drop area" })).toBeVisible();
    await noOverflow(page);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Simulated checks", exact: true })).toBeVisible();
  await page.goto(workspaceUrl(ids.otherBank));
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await expect(page.getByText("Synthetic Birch Services", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Assigned officer", { exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("queue loading and service failure are clear and retryable", async ({ page }) => {
  const queuePattern = /\/api\/v1\/banks\/[^/]+\/staff\/applications\?/;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(queuePattern, async (route) => {
    await pending;
    return route.continue();
  });
  try {
    await signIn(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Loading applications" }),
    ).toBeVisible();
    await noOverflow(page);
  } finally {
    release();
  }
  await expect(
    page.getByRole("link", { name: "Synthetic Cedar Workshop", exact: true }).first(),
  ).toBeVisible();
  await page.unroute(queuePattern);
  await page.route(queuePattern, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "UNAVAILABLE", message: "Applications are temporarily unavailable." },
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await noOverflow(page);
  await page.unroute(queuePattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic Cedar Workshop", exact: true }).first(),
  ).toBeVisible();
});

test("an address without staff membership cannot open the staff queue", async ({ page }) => {
  await page.goto(staff);
  const email = `staff-workspace-denied-${randomUUID()}@example.test`;
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("can’t access this staff demo");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(email);
  await expect(page.getByRole("link", { name: "Create application", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Synthetic Cedar Workshop", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch("/api/v1/auth/staff")).status)).toBe(404);
  await noOverflow(page);
});

test("a stale internal note preserves edits until staff explicitly reloads the saved note", async ({
  page,
  context,
}) => {
  await signIn(page);
  const application = await namedDraft(
    page,
    `Synthetic Note Conflict ${randomUUID().slice(0, 8)}`,
    `staff-note-conflict-${randomUUID()}@example.test`,
  );
  await page.goto(workspaceUrl(application.id, "notes"));
  await page.getByLabel("New internal note", { exact: true }).fill("Synthetic original note.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Internal note added." })).toBeVisible();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page
    .getByLabel("Edit internal note", { exact: true })
    .fill("Synthetic unsaved local edit.");
  const otherPage = await context.newPage();
  try {
    await otherPage.goto(workspaceUrl(application.id, "notes"));
    await otherPage.getByRole("button", { name: "Edit note", exact: true }).click();
    await otherPage
      .getByLabel("Edit internal note", { exact: true })
      .fill("Synthetic newer saved note.");
    await otherPage.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(otherPage.getByLabel("Edit internal note", { exact: true })).toHaveCount(0);
    await expect(otherPage.getByText("Synthetic newer saved note.", { exact: true })).toBeVisible();

    await page.bringToFront();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("record changed");
    await expect(page.getByLabel("Edit internal note", { exact: true })).toHaveValue(
      "Synthetic unsaved local edit.",
    );
    await page
      .getByRole("button", { name: "Reload saved record and replace edits", exact: true })
      .click();
    await expect(page.getByLabel("Edit internal note", { exact: true })).toHaveValue(
      "Synthetic newer saved note.",
    );
    await page.getByLabel("Edit internal note", { exact: true }).fill("Synthetic reconciled note.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByLabel("Edit internal note", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Synthetic reconciled note.", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic unsaved local edit.", { exact: true })).toHaveCount(0);
    await noOverflow(page);
  } finally {
    await otherPage.close();
  }
});
