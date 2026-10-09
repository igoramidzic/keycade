import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";
import { fillSignInEmail } from "./identity-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const small = "60000000-0000-4000-8000-000000000001";
const tasksUrl = (origin: string) => `${origin}/applications/${small}/tasks?bank=bank-a`;
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

async function signIn(page: Page, origin: string, email: string) {
  await page.goto(origin);
  await fillSignInEmail(page, email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(tasksUrl(origin));
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

for (const [actor, origin, email] of [
  ["borrower", borrower, "borrower@example.test"],
  ["staff", staff, "officer-a@example.test"],
] as const) {
  test(`${actor} task accordions open from the initial workspace data without fetching or flashing loading`, async ({
    page,
  }) => {
    await page.clock.install();
    const detailRequests: string[] = [];
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && /\/documents$/.test(request.url())) documentRequests++;
    });
    await page.route(/\/tasks\/[0-9a-f-]+$/, async (route) => {
      if (route.request().method() === "GET") {
        detailRequests.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    await signIn(page, origin, email);
    const initialDocumentRequests = documentRequests;
    expect(initialDocumentRequests).toBeGreaterThan(0);
    await page.evaluate(() => {
      const state = window as Window & { taskLoadingSeen?: boolean };
      state.taskLoadingSeen = false;
      new MutationObserver(() => {
        if (
          [...document.querySelectorAll('[id^="task-detail-"] [role="status"]')].some((status) =>
            /^\s*Loading(?:\s|…|\.)/.test(status.textContent ?? ""),
          )
        )
          state.taskLoadingSeen = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    for (const title of [
      "Describe your business",
      "Confirm business entity details",
      "Describe your business",
    ]) {
      const toggle = page.getByRole("button", { name: title, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      // The previously open task may still be animating closed; check the panel just opened.
      const panel = page.locator(
        `#${(await toggle.getAttribute("id"))?.replace("task-toggle-", "task-detail-")}`,
      );
      await expect(panel.locator('[id^="task-answer-"]')).toBeVisible();
      // Borrowers upload shared business files in the sidebar; staff keep task documents.
      await expect(panel.getByRole("heading", { name: "Task documents", exact: true })).toHaveCount(
        actor === "staff" ? 1 : 0,
      );
      await page.clock.runFor(100);
    }
    expect(detailRequests).toEqual([]);
    expect(documentRequests).toBe(initialDocumentRequests);
    expect(
      await page.evaluate(() => (window as Window & { taskLoadingSeen?: boolean }).taskLoadingSeen),
    ).toBe(false);
    await noOverflow(page);
  });
}

test("application dashboard keeps tasks beside details on desktop and stacks them on mobile", async ({
  page,
}, testInfo) => {
  await signIn(page, borrower, "borrower@example.test");
  for (const url of [tasksUrl(borrower), `${borrower}/applications/${small}?bank=bank-a`]) {
    if (page.url() !== url) await page.goto(url);
    const taskPanel = page.getByRole("region", { name: "Application tasks", exact: true });
    const details = page.getByRole("complementary", { name: "Application details", exact: true });
    await expect(taskPanel.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await expect(details).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Application sections", exact: true }),
    ).toHaveCount(0);
    await expect(
      details.getByRole("heading", { name: "Upload other documents", exact: true }),
    ).toBeVisible();
    const taskBox = await taskPanel.boundingBox();
    const detailsBox = await details.boundingBox();
    if (!taskBox || !detailsBox) throw new Error("Expected visible application dashboard regions.");
    if (testInfo.project.name === "desktop") {
      expect(taskBox.x + taskBox.width).toBeLessThanOrEqual(detailsBox.x + 1);
      expect(taskBox.width).toBeGreaterThan(detailsBox.width);
      expect(detailsBox.y).toBeLessThan(taskBox.y + taskBox.height);
    } else {
      expect(detailsBox.y).toBeGreaterThanOrEqual(taskBox.y + taskBox.height - 1);
      const summary = page.getByRole("region", { name: "Current application", exact: true });
      await expect(summary).toBeVisible();
      const summaryBox = await summary.boundingBox();
      if (!summaryBox) throw new Error("Expected the compact mobile application summary.");
      expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(taskBox.y + 1);
      expect(Math.abs(detailsBox.x - taskBox.x)).toBeLessThanOrEqual(2);
    }
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(
        url === tasksUrl(borrower)
          ? "synthetic-tasks-dashboard-collapsed.png"
          : "synthetic-overview-dashboard-collapsed.png",
      ),
      fullPage: true,
    });

    const first = taskPanel.getByRole("button", { name: "Describe your business", exact: true });
    const next = taskPanel.getByRole("button", {
      name: "Confirm business entity details",
      exact: true,
    });
    await expect(next).toBeVisible();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const controlledId = await first.getAttribute("aria-controls");
    if (!controlledId) throw new Error("Expected an accessible task detail control.");
    const expanded = taskPanel.locator(`[id="${controlledId}"]`);
    await expect(expanded.locator('[id^="task-answer-"]')).toBeVisible();
    const triggerBox = await first.boundingBox();
    const expandedBox = await expanded.boundingBox();
    const rowBox = await first.locator("xpath=ancestor::li[1]").boundingBox();
    if (!triggerBox || !expandedBox || !rowBox)
      throw new Error("Expected visible task accordion rows.");
    expect(expandedBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
    expect(expandedBox.y + expandedBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    await noOverflow(page);
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(expanded).toBeHidden();
    await first.click();
    await expanded.locator('[id^="task-answer-"]').fill("Unsaved synthetic draft");
    await next.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "You have unsaved changes" }),
    ).toBeVisible();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(expanded.locator('[id^="task-answer-"]')).toHaveValue("Unsaved synthetic draft");
    await next.click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(next).toHaveAttribute("aria-expanded", "true");
    await noOverflow(page);
  }
});

test("task switch confirmation stays locked until a pending answer save finishes", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  const current = page.getByRole("button", { name: "Describe your business", exact: true });
  const next = page.getByRole("button", { name: "Confirm business entity details", exact: true });
  const answer = `Synthetic answer saved during task switching ${randomUUID().slice(0, 8)}`;
  await current.click();
  await page.locator('[id^="task-answer-"]').fill(answer);
  await next.click();
  const confirmation = page.getByRole("alert").filter({ hasText: "You have unsaved changes" });
  await expect(confirmation).toBeVisible();

  const pattern = /\/api\/v1\/banks\/[^/]+\/applications\/[^/]+\/tasks\/[^/]+\/answer$/;
  let releaseAnswer!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() === "PATCH") await gate;
    await route.continue();
  });
  try {
    const saving = page.waitForRequest(
      (request) => request.method() === "PATCH" && pattern.test(request.url()),
    );
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await saving;
    await expect(
      confirmation.getByRole("button", { name: "Keep editing", exact: true }),
    ).toBeDisabled();
    await expect(
      confirmation.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    await expect(current).toHaveAttribute("aria-expanded", "true");
    await expect(next).toHaveAttribute("aria-expanded", "false");
    releaseAnswer();
    await expect(page.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await expect(confirmation).toBeHidden();
    await expect(page.locator('[id^="task-answer-"]')).toHaveValue(answer);
    await expect(page.getByRole("button", { name: "Complete task", exact: true })).toBeEnabled();
    await next.click();
    await expect(next).toHaveAttribute("aria-expanded", "true");
    await expect(current).toHaveAttribute("aria-expanded", "false");
    await expect(confirmation).toBeHidden();
    await current.click();
    // The other task may still be animating closed, so read the answer in this task's panel.
    await expect(
      page
        .getByRole("region", { name: "Describe your business", exact: true })
        .locator('[id^="task-answer-"]'),
    ).toHaveValue(answer);
    await noOverflow(page);
  } finally {
    releaseAnswer();
    await page.unroute(pattern);
  }
});

test("staff requests a task, borrower submits, staff returns changes and completes the revised answer", async ({
  page,
  browser,
}, testInfo) => {
  const title = `Synthetic equipment explanation ${randomUUID().slice(0, 8)}`;
  await signIn(page, staff, "officer-a@example.test");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill(title);
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Describe the fictional equipment request.");
  await page
    .getByLabel("Assigned participant", { exact: true })
    .selectOption({ label: "Synthetic Borrower" });
  await page.getByLabel("Due date (optional)", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await noOverflow(page);

  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const applicant = await context.newPage();
    await signIn(applicant, borrower, "borrower@example.test");
    await applicant.getByRole("button", { name: title, exact: true }).click();
    await applicant.locator('[id^="task-answer-"]').fill("Synthetic equipment for the workshop.");
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await expect(
      applicant.getByRole("button", { name: "Complete task", exact: true }),
    ).toBeEnabled();
    await expect(applicant.getByRole("button", { name: "Mark reviewed", exact: true })).toHaveCount(
      0,
    );
    await applicant.getByRole("button", { name: "Complete task", exact: true }).click();
    await expect(
      applicant.getByRole("status").filter({ hasText: "Task completed." }),
    ).toBeVisible();
    // Completing is final for the client; only the lender sees it awaiting review.
    await expect(applicant.locator("li").filter({ hasText: title }).first()).toContainText(
      "Completed",
    );
    await noOverflow(applicant);

    await page.reload();
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(page.locator('[id^="task-answer-"]')).toHaveValue(
      "Synthetic equipment for the workshop.",
    );
    await expect(page.locator("li").filter({ hasText: title }).first()).toContainText(
      "Needs your review",
    );
    await expect(page.getByRole("button", { name: "Mark reviewed", exact: true })).toBeDisabled();
    await page
      .getByLabel("Review or waiver reason", { exact: true })
      .fill("Please describe the equipment and delivery.");
    await page.getByRole("button", { name: "Return for changes", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "returned to the assignee" }),
    ).toBeVisible();

    await applicant.reload();
    await applicant.getByRole("button", { name: title, exact: true }).click();
    await expect(
      applicant.getByText("Please describe the equipment and delivery.", { exact: true }).first(),
    ).toBeVisible();
    await applicant
      .locator('[id^="task-answer-"]')
      .fill("Synthetic woodworking equipment with delivery to the fictional workshop.");
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await applicant.getByRole("button", { name: "Complete task", exact: true }).click();
    await expect(
      applicant.getByRole("status").filter({ hasText: "Task completed." }),
    ).toBeVisible();
    await applicant.screenshot({
      path: testInfo.outputPath("synthetic-borrower-task-submitted.png"),
      fullPage: true,
    });

    await page.reload();
    await page.getByRole("button", { name: title, exact: true }).click();
    await page
      .getByLabel("Review or waiver reason", { exact: true })
      .fill("Synthetic revised explanation reviewed.");
    await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Task marked reviewed." }),
    ).toBeVisible();
    const historyToggle = page.getByRole("button", { name: "Details and history", exact: true });
    await historyToggle.click();
    const history = page.locator(`[id="${await historyToggle.getAttribute("aria-controls")}"]`);
    await expect(
      history.getByText("Synthetic equipment for the workshop.", { exact: true }),
    ).toBeVisible();
    await expect(
      history.getByText(
        "Synthetic woodworking equipment with delivery to the fictional workshop.",
        { exact: true },
      ),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("synthetic-task-review.png"),
      fullPage: true,
    });
    await applicant.reload();
    await applicant.getByRole("button", { name: title, exact: true }).click();
    // Completed review notes live in the collapsed details; only returned tasks show them inline.
    const reviewNote = applicant.getByText("Synthetic revised explanation reviewed.", {
      exact: true,
    });
    await expect(reviewNote).toBeHidden();
    await applicant.getByText("Details and history", { exact: true }).click();
    await expect(reviewNote).toBeVisible();
    await noOverflow(applicant);
    await applicant.screenshot({
      path: testInfo.outputPath("synthetic-borrower-task.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("restricted participant task list is scoped and task failures remain retryable", async ({
  page,
}) => {
  await signIn(page, borrower, "adviser@example.test");
  await expect(
    page.getByText("No applicable tasks are visible for your account.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 of 0", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task", exact: true })).toHaveCount(0);
  await expect(page.getByText("Confirm owner information readiness", { exact: true })).toHaveCount(
    0,
  );
  const pattern = /\/api\/v1\/banks\/[^/]+\/applications\/[^/]+\/tasks$/;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: "SERVICE_UNAVAILABLE", message: "Tasks are temporarily unavailable." },
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("No applicable tasks are visible for your account.", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});
