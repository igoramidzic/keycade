import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const small = "60000000-0000-4000-8000-000000000001";
const tasksUrl = (origin: string) => `${origin}/applications/${small}/tasks?bank=bank-a`;
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(90_000);

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
    const taskBox = await taskPanel.boundingBox();
    const detailsBox = await details.boundingBox();
    if (!taskBox || !detailsBox) throw new Error("Expected visible application dashboard regions.");
    if (testInfo.project.name === "desktop") {
      expect(taskBox.x + taskBox.width).toBeLessThanOrEqual(detailsBox.x + 1);
      expect(taskBox.width).toBeGreaterThan(detailsBox.width);
      expect(detailsBox.y).toBeLessThan(taskBox.y + taskBox.height);
    } else {
      expect(detailsBox.y).toBeGreaterThanOrEqual(taskBox.y + taskBox.height - 1);
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

    const toggles = taskPanel.locator("button[aria-controls][aria-expanded]");
    await expect(toggles.nth(1)).toBeVisible();
    const first = toggles.first();
    const controlledId = await first.getAttribute("aria-controls");
    if (!controlledId) throw new Error("Expected an accessible task detail control.");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const expanded = taskPanel.locator(`[id="${controlledId}"]`);
    await expect(expanded.getByLabel("Your answer", { exact: true })).toBeVisible();
    const triggerBox = await first.boundingBox();
    const expandedBox = await expanded.boundingBox();
    const nextBox = await toggles.nth(1).boundingBox();
    if (!triggerBox || !expandedBox || !nextBox)
      throw new Error("Expected visible task accordion rows.");
    expect(expandedBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
    expect(expandedBox.y + expandedBox.height).toBeLessThanOrEqual(nextBox.y + 1);
    await noOverflow(page);
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(expanded).toBeHidden();
    await first.click();
    await expanded.getByLabel("Your answer", { exact: true }).fill("Unsaved synthetic draft");
    await toggles.nth(1).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "You have unsaved changes" }),
    ).toBeVisible();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(expanded.getByLabel("Your answer", { exact: true })).toHaveValue(
      "Unsaved synthetic draft",
    );
    await toggles.nth(1).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");
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
  await page.getByLabel("Your answer", { exact: true }).fill(answer);
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
    await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(answer);
    await expect(
      page.getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeEnabled();
    await next.click();
    await expect(next).toHaveAttribute("aria-expanded", "true");
    await expect(current).toHaveAttribute("aria-expanded", "false");
    await expect(confirmation).toBeHidden();
    await current.click();
    await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(answer);
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
    await applicant
      .getByLabel("Your answer", { exact: true })
      .fill("Synthetic equipment for the workshop.");
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await expect(
      applicant.getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeEnabled();
    await expect(applicant.getByRole("button", { name: "Complete task", exact: true })).toHaveCount(
      0,
    );
    await applicant.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(
      applicant.getByRole("status").filter({ hasText: "Answer submitted" }),
    ).toBeVisible();
    await noOverflow(applicant);

    await page.reload();
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
      "Synthetic equipment for the workshop.",
    );
    await expect(page.getByRole("button", { name: "Complete task", exact: true })).toBeDisabled();
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
      .getByLabel("Your answer", { exact: true })
      .fill("Synthetic woodworking equipment with delivery to the fictional workshop.");
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await applicant.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(
      applicant.getByRole("status").filter({ hasText: "Answer submitted" }),
    ).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: title, exact: true }).click();
    await page
      .getByLabel("Review or waiver reason", { exact: true })
      .fill("Synthetic revised explanation reviewed.");
    await page.getByRole("button", { name: "Complete task", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
    await page.getByText("Task history", { exact: true }).click();
    await expect(
      page.getByText("Synthetic equipment for the workshop.", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group")
        .getByText("Synthetic woodworking equipment with delivery to the fictional workshop.", {
          exact: true,
        }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("synthetic-task-review.png"),
      fullPage: true,
    });
    await applicant.reload();
    await applicant.getByRole("button", { name: title, exact: true }).click();
    await expect(
      applicant.getByText("Synthetic revised explanation reviewed.", { exact: true }).first(),
    ).toBeVisible();
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
