import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { TasksView, TaskView } from "@keycade/contracts";
import { expect, type Page, test } from "@playwright/test";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
// Session and CSRF values stay within the browser; artifacts contain synthetic answers only.
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
}
async function tasksApi<T>(page: Page, method: string, path = "", body?: object): Promise<T> {
  return page.evaluate(
    async ({ method, path, body, applicationId }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      if (!session.authenticated) throw new Error("Expected a synthetic session.");
      const response = await fetch(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/tasks${path}`,
        {
          method,
          headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) throw new Error(`Synthetic task operation failed (${response.status}).`);
      return response.json();
    },
    { method, path, body, applicationId },
  );
}

for (const actor of ["borrower", "staff"] as const) {
  test(`successful ${actor} saves do not report a conflict while summaries refresh`, async ({
    page,
  }) => {
    const isBorrower = actor === "borrower";
    const origin = isBorrower ? borrower : staff;
    await signIn(page, origin, isBorrower ? "borrower@example.test" : "officer-a@example.test");
    await page.clock.install();
    await page.goto(`${origin}/applications/${applicationId}/tasks?bank=bank-a`);
    const initial = await tasksApi<TasksView>(page, "GET");
    const task = initial.tasks.find((item) => item.title === "Describe your business");
    if (!task) throw new Error("Synthetic business description task missing.");
    await page.getByRole("button", { name: task.title, exact: true }).click();
    const input = page.getByLabel(isBorrower ? "Your answer" : "Due date (optional)", {
      exact: true,
    });
    const value = isBorrower ? `Synthetic saved answer ${randomUUID().slice(0, 8)}` : "2026-12-01";
    await input.fill(value);

    // The save refreshes the list before this summary. Hold the summary to expose the
    // intermediate render reliably instead of hoping to catch a millisecond flash.
    const summaryPattern = new RegExp(
      `/applications/${applicationId}/${isBorrower ? "portal" : "workspace"}$`,
    );
    let releaseSummary!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    await page.route(summaryPattern, async (route) => {
      await gate;
      await route.continue();
    });
    const conflict = page.getByRole("alert").filter({ hasText: "This task has changed" });
    const save = page.getByRole("button", {
      name: isBorrower ? "Save answer" : "Save assignment",
      exact: true,
    });
    try {
      const refresh = page.waitForRequest(summaryPattern);
      await save.click();
      await refresh;
      const committed = await tasksApi<TaskView>(page, "GET", `/${task.id}`);
      expect(committed.revision).toBe(task.revision + 1);
      // Flush the list's scheduled React render while the save is still pending.
      await page.clock.runFor(100);
      await expect(input).toBeDisabled();
      await expect(conflict).toHaveCount(0);
      releaseSummary();
      await expect(
        page.getByRole("status").filter({
          hasText: isBorrower ? "Answer saved." : "Assignment and due date saved.",
        }),
      ).toBeVisible();
      await expect(conflict).toHaveCount(0);
      await expect(input).toHaveValue(value);
      await page.unroute(summaryPattern);

      // A genuinely newer version arriving through polling must still protect this form.
      await tasksApi<TaskView>(
        page,
        "PATCH",
        `/${task.id}/${isBorrower ? "answer" : "assignment"}`,
        {
          expectedRevision: committed.revision,
          ...(isBorrower
            ? { answer: "A different editor's synthetic answer." }
            : {
                participantId: committed.assigneeParticipantId,
                dueAt: "2026-12-02T23:59:59.000Z",
              }),
        },
      );
      await page.clock.fastForward(15_001);
      await expect(conflict).toBeVisible();
      await expect(input).toHaveValue(value);
      await expect(save).toBeDisabled();
    } finally {
      releaseSummary();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("stale task answers keep typed text until the borrower explicitly reloads the saved revision", async ({
  page,
  browser,
}) => {
  const title = `Synthetic concurrency task ${randomUUID().slice(0, 8)}`;
  await signIn(page, staff, "officer-a@example.test");
  const initial = await tasksApi<TasksView>(page, "GET");
  const participant = initial.assignees.find(
    (person) => person.displayName === "Synthetic Borrower",
  );
  if (!participant) throw new Error("Synthetic borrower participant missing.");
  const created = await tasksApi<TasksView>(page, "POST", "", {
    idempotencyKey: randomUUID(),
    title,
    description: "Describe the fictional business premises.",
    assigneeParticipantId: participant.id,
    stage: "submission",
    required: true,
    visibility: "shared",
  });
  const task = created.tasks.find((item) => item.title === title);
  if (!task) throw new Error("Synthetic manual task missing.");
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const applicant = await context.newPage();
    await signIn(applicant, borrower, "borrower@example.test");
    await applicant.goto(`${borrower}/applications/${applicationId}/tasks?bank=bank-a`);
    await applicant.getByRole("button", { name: title, exact: true }).click();
    const answer = applicant.getByLabel("Your answer", { exact: true });
    await answer.fill("My unsaved fictional workshop description.");
    const visibleList = await tasksApi<TasksView>(applicant, "GET");
    const taskListPattern = /\/api\/v1\/banks\/[^/]+\/applications\/[^/]+\/tasks$/;
    await applicant.route(taskListPattern, (route) => route.fulfill({ json: visibleList }));
    // A second editor commits to the real database without changing this form's revision.
    const concurrent = await tasksApi<TaskView>(applicant, "PATCH", `/${task.id}/answer`, {
      expectedRevision: task.revision,
      answer: "A concurrent synthetic answer already saved.",
    });
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("alert")).toContainText("This task changed.");
    await expect(answer).toHaveValue("My unsaved fictional workshop description.");
    await expect(applicant.getByRole("alert")).toContainText(
      "Reloading replaces your unsaved entries.",
    );
    expect((await tasksApi<TaskView>(applicant, "GET", `/${task.id}`)).revision).toBe(
      concurrent.revision,
    );
    await applicant.getByRole("button", { name: "Reload saved task", exact: true }).click();
    await expect(answer).toHaveValue("A concurrent synthetic answer already saved.");
    // A freshly loaded editor may be newer than the cached list; that is not a conflict.
    await expect(applicant.getByRole("alert")).toHaveCount(0);
    await applicant.unroute(taskListPattern);
    await answer.fill("A revised fictional description after checking the newer answer.");
    await applicant.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(applicant.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    const saved = await tasksApi<TaskView>(applicant, "GET", `/${task.id}`);
    expect(saved.answer).toBe("A revised fictional description after checking the newer answer.");
    expect(saved.state).toBe("open");
    expect(saved.revision).toBe(concurrent.revision + 1);
  } finally {
    await context.close();
  }
});
