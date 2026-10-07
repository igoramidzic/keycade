import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const ids = {
  small: "60000000-0000-4000-8000-000000000001",
  large: "60000000-0000-4000-8000-000000000002",
  unshared: "60000000-0000-4000-8000-000000000003",
  otherBank: "60000000-0000-4000-8000-000000000004",
  draft: "60000000-0000-4000-8000-000000000006",
  closed: "60000000-0000-4000-8000-000000000007",
};

// Session cookies and CSRF values stay out of browser artifacts and failure reports.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(75_000);

type Setup = {
  id: string;
  businessName: string | null;
  requestedAmount: string | null;
  purpose: string | null;
  currentStep: string;
  revision: number;
  setupStatus: string;
};

async function api<T>(page: Page, method: string, suffix: string, body?: object): Promise<T> {
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
      if (!response.ok) throw new Error(`Synthetic workspace fixture failed (${response.status}).`);
      return response.json();
    },
    { method, suffix, body },
  );
}

async function signIn(page: Page, email = "borrower@example.test") {
  await page.goto(borrower);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
}

const card = (page: Page, id: string) =>
  page.getByRole("article", { name: `Application ${id}`, exact: true });
const applicationUrl = (id: string, section = "") =>
  `${borrower}/applications/${id}${section ? `/${section}` : ""}?bank=bank-a`;

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function draft(page: Page, name: string) {
  const created = await api<Setup>(page, "POST", "", { idempotencyKey: randomUUID() });
  return api<Setup>(page, "PATCH", `/${created.id}/setup`, {
    expectedRevision: created.revision,
    answers: { businessName: name },
    step: "business_name",
    currentStep: "amount",
  });
}

test("business groups show granted applications and portal navigation keeps application context", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const cedar = page.getByRole("region", { name: "Synthetic Cedar Workshop", exact: true });
  const maple = page.getByRole("region", { name: "Synthetic Maple Supply", exact: true });
  await expect(cedar.getByRole("article", { name: `Application ${ids.small}` })).toBeVisible();
  await expect(cedar.getByRole("article", { name: `Application ${ids.draft}` })).toBeVisible();
  await expect(maple.getByRole("article", { name: `Application ${ids.large}` })).toBeVisible();
  await expect(card(page, ids.small)).toContainText("Synthetic Business Credit");
  await expect(card(page, ids.small)).toContainText("$10,000");
  await expect(card(page, ids.large)).toContainText("$5,000,000");
  await expect(card(page, ids.small)).toContainText("Collecting information");
  await expect(card(page, ids.small).locator("time")).toHaveAttribute("datetime", /.+/);
  await expect(card(page, ids.unshared)).toHaveCount(0);
  await expect(card(page, ids.otherBank)).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await noOverflow(page);
  // These deliberately captured synthetic screens contain no bearer links or session values.
  await page.screenshot({ path: testInfo.outputPath("synthetic-dashboard.png"), fullPage: true });

  const open = card(page, ids.small).getByRole("button", { name: "Open application", exact: true });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(applicationUrl(ids.small));
  await expect(
    page.getByRole("heading", { name: "Synthetic Cedar Workshop", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("synthetic-overview.png"), fullPage: true });
  await page.getByRole("link", { name: "View tasks", exact: true }).click();
  await expect(page).toHaveURL(applicationUrl(ids.small, "tasks"));
  await expect(page.getByText("Tasks are not available yet", { exact: true })).toBeVisible();
  for (const section of [
    { path: "documents", label: "Documents", empty: "Documents are not available yet" },
    { path: "people", label: "People", empty: "People management is not available yet" },
    { path: "activity", label: "Activity", empty: "Activity is not available yet" },
  ]) {
    await page.getByRole("link", { name: section.label, exact: true }).click();
    await expect(page).toHaveURL(applicationUrl(ids.small, section.path));
    await expect(page.getByText(section.empty, { exact: true })).toBeVisible();
    await noOverflow(page);
  }
  await page.reload();
  await expect(page.getByText("Activity is not available yet", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Your applications", exact: true }).click();
  await card(page, ids.large)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page).toHaveURL(applicationUrl(ids.large));
  await expect(
    page.getByRole("heading", { name: "Synthetic Maple Supply", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$5,000,000", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic equipment purchase", { exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("editing separate drafts preserves each saved step and completion opens only its own portal", async ({
  page,
}) => {
  await signIn(page, `workspace-isolation-${randomUUID()}@example.test`);
  const first = await draft(page, "Synthetic Harbor Workshop");
  const second = await draft(page, "Synthetic Valley Supply");
  await page.reload();
  await card(page, first.id).getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("");
  await page.getByLabel("Requested amount", { exact: true }).fill("12345.67");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Loan purpose", { exact: true })).toBeVisible();
  await page.getByLabel("Loan purpose", { exact: true }).fill("Synthetic harbor equipment");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await card(page, second.id).getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue("");
  await page.getByLabel("Requested amount", { exact: true }).fill("76543.21");
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your progress is saved." }),
  ).toBeVisible();
  await card(page, first.id).getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByLabel("Loan purpose", { exact: true })).toHaveValue(
    "Synthetic harbor equipment",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(/12,?345\.67/);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Loan purpose", { exact: true }).fill("Synthetic harbor equipment");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Industry", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page).toHaveURL(applicationUrl(first.id));
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  expect(await api<Setup>(page, "GET", `/${first.id}/setup`)).toMatchObject({
    requestedAmount: "12345.67",
    purpose: "Synthetic harbor equipment",
    setupStatus: "completed",
  });
  expect(await api<Setup>(page, "GET", `/${second.id}/setup`)).toMatchObject({
    requestedAmount: "76543.21",
    purpose: null,
    currentStep: "amount",
    setupStatus: "in_progress",
  });
  await page.goto(applicationUrl(second.id, "tasks"));
  await expect(page).toHaveURL(applicationUrl(second.id, "setup"));
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(/76,?543\.21/);
  await page.reload();
  await expect(page.getByLabel("Requested amount", { exact: true })).toHaveValue(/76,?543\.21/);
  await page.goto(applicationUrl(first.id, "setup"));
  await expect(page).toHaveURL(applicationUrl(first.id));
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("limited invited participants see scoped summaries without applicant setup or management controls", async ({
  page,
}) => {
  await signIn(page, "adviser@example.test");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card(page, ids.small)).toContainText("Limited access");
  await expect(page.getByText("$10,000", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue setup", exact: true })).toHaveCount(0);
  await card(page, ids.small)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page.getByText("Limited access", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic equipment purchase", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /invite|upload|finish setup/i })).toHaveCount(0);
  await page.goto(applicationUrl(ids.small, "setup"));
  await expect(page).toHaveURL(applicationUrl(ids.small));
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Tasks are not available yet", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Limited access", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.goto(applicationUrl(ids.large));
  await expect(page.getByRole("alert")).toContainText("unavailable for your account");
  await expect(page.getByText("$5,000,000", { exact: true })).toHaveCount(0);
});

test("closed drafts and guessed application links do not loop or expose an applicant workspace", async ({
  page,
}) => {
  await signIn(page);
  await card(page, ids.closed)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  await page.goto(applicationUrl(ids.closed, "setup"));
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
  for (const applicationId of [ids.unshared, ids.otherBank]) {
    await page.goto(applicationUrl(applicationId, "tasks"));
    await expect(page.getByRole("alert")).toContainText("unavailable for your account");
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toHaveCount(0);
    await noOverflow(page);
  }
  await page.getByRole("link", { name: "Your applications", exact: true }).click();
  await card(page, ids.small)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page).toHaveURL(applicationUrl(ids.small));
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
});

test("empty dashboard provides loading feedback and recovers from a server failure", async ({
  page,
}) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listPattern = /\/api\/v1\/banks\/[^/]+\/applications\?/;
  await page.route(listPattern, async (route) => {
    await pending;
    return route.continue();
  });
  try {
    await signIn(page, `workspace-empty-${randomUUID()}@example.test`);
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await noOverflow(page);
  } finally {
    release();
  }
  await expect(page.getByText("No applications yet", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start a new application", exact: true }),
  ).toBeVisible();
  await page.unroute(listPattern);
  await page.route(listPattern, (route) =>
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
  await page.unroute(listPattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("No applications yet", { exact: true })).toBeVisible();
});

test("portal detail failure retries the selected application without replaying setup", async ({
  page,
}) => {
  await signIn(page);
  const detailPattern = `**/applications/${ids.large}/portal`;
  await page.route(detailPattern, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "UNAVAILABLE", message: "Application details are temporarily unavailable." },
      },
    }),
  );
  await card(page, ids.large)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page).toHaveURL(applicationUrl(ids.large));
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.unroute(detailPattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic Maple Supply", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
});

test("portal polling replaces an application that closes with its closed state", async ({
  page,
}) => {
  await signIn(page);
  await page.clock.install();
  let closed = false;
  let detailReads = 0;
  await page.route(`**/applications/${ids.small}/portal`, async (route) => {
    detailReads += 1;
    if (!closed) return route.continue();
    const response = await route.fetch();
    const current = await response.json();
    return route.fulfill({
      response,
      json: { ...current, status: "withdrawn", nextDestination: "closed" },
    });
  });
  await card(page, ids.small)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page).toHaveURL(applicationUrl(ids.small));
  await expect(page.getByText("Initial setup complete", { exact: true })).toBeVisible();
  const initialReads = detailReads;
  closed = true;
  await page.clock.fastForward(30_001);
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  expect(detailReads).toBeGreaterThan(initialReads);
  await expect(
    page.getByRole("navigation", { name: "Application sections", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View tasks", exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("an invited participant with full scope is not told unfinished applicant setup is complete", async ({
  page,
}) => {
  await signIn(page, "adviser@example.test");
  // Exercise the UI projection for a full-scope participant on an unfinished application.
  // Real participant grants and server setup guards are covered by integration tests.
  await page.route(`**/applications/${ids.small}/portal`, async (route) => {
    const response = await route.fetch();
    const current = await response.json();
    return route.fulfill({
      response,
      json: {
        ...current,
        accessScope: "full",
        setupStatus: "in_progress",
        nextDestination: "assigned",
        status: "draft",
        currentStep: "business_name",
      },
    });
  });
  await card(page, ids.small)
    .getByRole("button", { name: "Open application", exact: true })
    .click();
  await expect(page).toHaveURL(applicationUrl(ids.small));
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText("Initial setup complete", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Tasks are not available yet", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("polling after an account switch clears application cards and detail instead of mixing account caches", async ({
  page,
  context,
}) => {
  // Install before queries schedule their intervals; Playwright shares this clock across tabs.
  await page.clock.install();
  await signIn(page);
  await expect(card(page, ids.small)).toBeVisible();
  const detailPage = await context.newPage();
  const switchPage = await context.newPage();
  try {
    await detailPage.goto(applicationUrl(ids.small));
    await expect(detailPage.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await switchPage.goto(borrower);
    expect(
      await switchPage.evaluate(async (email) => {
        const session = await (await fetch("/api/v1/auth/session")).json();
        return (
          await fetch("/api/v1/auth/demo-sign-in", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
            body: JSON.stringify({
              email,
              bankSlug: "bank-a",
              portal: "borrower",
              returnPath: "/",
            }),
          })
        ).ok;
      }, `workspace-switched-${randomUUID()}@example.test`),
    ).toBe(true);
    await draft(switchPage, "Synthetic Other Account Business");
    for (const stalePage of [page, detailPage]) {
      // Queries intentionally poll only in foreground tabs.
      await stalePage.bringToFront();
      await stalePage.clock.fastForward(30_001);
      await expect(stalePage.getByRole("alert")).toContainText("Your sign-in changed");
      await expect(stalePage.getByRole("article")).toHaveCount(0);
      await expect(
        stalePage.getByRole("navigation", { name: "Application sections", exact: true }),
      ).toHaveCount(0);
      await expect(stalePage.getByText("Synthetic Cedar Workshop", { exact: true })).toHaveCount(0);
      await expect(
        stalePage.getByText("Synthetic Other Account Business", { exact: true }),
      ).toHaveCount(0);
      await noOverflow(stalePage);
    }
  } finally {
    await detailPage.close();
    await switchPage.close();
  }
});
