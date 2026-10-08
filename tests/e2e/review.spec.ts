import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { ApplicationSetup, ReviewView, TasksView, TaskView } from "@keycade/contracts";
import { expect as baseExpect, type Page, test } from "@playwright/test";
import { setupFixtureSteps } from "../setup-fixture";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
// Navigation can queue several deliberately paced requests before rendering.
const expect = baseExpect.configure({ timeout: 15000 });
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.setTimeout(150000);
const url = (origin: string, id: string, section = "review") =>
  `${origin}/applications/${id}/${section}?bank=bank-a`;
function paceRequests() {
  let nextRequest = 0;
  return async (page: Page) => {
    // Both actors share the application's 120/minute IP budget. Session reads
    // have their own 240/minute budget and must not delay queued navigation.
    await page.route("**/api/**", async (route) => {
      if (!route.request().url().includes("/api/v1/auth/session")) {
        const now = Date.now();
        const wait = Math.max(0, nextRequest - now);
        nextRequest = Math.max(now, nextRequest) + 800;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try {
        await route.continue();
      } catch {
        // Parking an inactive page may cancel one of its queued polls.
      }
    });
  };
}
async function signIn(page: Page, origin: string) {
  await page.goto(origin);
  await page
    .getByLabel("Email address", { exact: true })
    .fill(origin === staff ? "officer-a@example.test" : "borrower@example.test");
  await page.getByRole("button", { name: "Sign in to demo", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: origin === staff ? "Applications" : "Your applications",
      exact: true,
    }),
  ).toBeVisible();
}
// Session/CSRF values stay inside the browser; all fixture data is synthetic.
async function api<T>(page: Page, method: string, suffix: string, body?: object): Promise<T> {
  return page.evaluate(
    async ({ method, suffix, body }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const response = await fetch(`/api/v1/banks/${session.bank.id}/applications${suffix}`, {
        method,
        headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          `Synthetic review fixture failed (${response.status}, ${error.error?.code ?? error.code ?? "unknown"}).`,
        );
      }
      return response.json();
    },
    { method, suffix, body },
  );
}
async function createApplication(page: Page, complete = true) {
  let application = await api<ApplicationSetup>(page, "POST", "", { idempotencyKey: randomUUID() });
  const steps = setupFixtureSteps(`Synthetic Review Workshop ${randomUUID().slice(0, 8)}`);
  for (const step of complete ? steps : steps.slice(0, 1))
    application = await api<ApplicationSetup>(page, "PATCH", `/${application.id}/setup`, {
      expectedRevision: application.revision,
      ...step,
    });
  if (complete)
    application = await api<ApplicationSetup>(page, "POST", `/${application.id}/setup/finish`, {
      definitionVersion: 2,
      expectedRevision: application.revision,
      idempotencyKey: randomUUID(),
    });
  return application;
}
async function completeSubmissionTasks(applicant: Page, officer: Page, id: string) {
  const view = await api<TasksView>(applicant, "GET", `/${id}/tasks`);
  for (let task of view.tasks.filter(
    (item) =>
      item.required &&
      item.stage === "submission" &&
      !["completed", "waived", "cancelled"].includes(item.state),
  )) {
    task = await api<TaskView>(applicant, "PATCH", `/${id}/tasks/${task.id}/answer`, {
      expectedRevision: task.revision,
      answer: "Synthetic workshop repairs demonstration equipment.",
    });
    task = await api<TaskView>(applicant, "POST", `/${id}/tasks/${task.id}/submit`, {
      expectedRevision: task.revision,
    });
    await api<TaskView>(officer, "POST", `/${id}/tasks/${task.id}/review`, {
      expectedRevision: task.revision,
      decision: "completed",
      reason: "Reviewed synthetic evidence for browser fixture.",
    });
  }
}
async function completeApprovalFixture(applicant: Page, officer: Page, id: string) {
  const visible = await api<TasksView>(applicant, "GET", `/${id}/tasks`);
  for (const task of visible.tasks.filter(
    (task) =>
      task.inputKind === "synthetic_business_identifier" ||
      task.inputKind === "synthetic_personal_identifier",
  ))
    await api(applicant, "POST", `/${id}/tasks/${task.id}/identifier`, {
      expectedRevision: task.revision,
      expectedInputRevision: task.secureInput?.revision ?? 0,
      value: "000000001",
    });
  const managed = await api<TasksView>(officer, "GET", `/${id}/tasks`);
  for (const task of managed.tasks.filter(
    (task) =>
      task.required &&
      task.stage === "approval" &&
      task.inputKind === "answer" &&
      !["completed", "waived", "cancelled"].includes(task.state),
  ))
    await api(officer, "POST", `/${id}/tasks/${task.id}/waive`, {
      expectedRevision: task.revision,
      reason: "Explicit synthetic browser fixture waiver.",
    });
  await expect
    .poll(
      async () =>
        (await api<ReviewView>(officer, "GET", `/${id}/review`)).readiness.gates
          .find((gate) => gate.stage === "approval")
          ?.blockers.filter((blocker) => blocker.kind !== "lifecycle").length,
      { timeout: 30000, intervals: [2000] },
    )
    .toBe(0);
}
async function submit(page: Page, resubmit = false) {
  await page
    .getByRole("button", {
      name: resubmit ? "Resubmit application" : "Submit application",
      exact: true,
    })
    .click();
  await page
    .getByLabel("I confirm this application is ready for bank review.", { exact: true })
    .check();
  await page.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(
    page.getByText(
      "This submission is waiting for bank review. Material application information is locked.",
      { exact: true },
    ),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("submission, returned information, immutable resubmission, and explicit approval retain private staff history", async ({
  page,
  browser,
}, testInfo) => {
  const pace = paceRequests();
  await pace(page);
  await signIn(page, borrower);
  await page.goto(`${borrower}/api/ready`);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await context.newPage();
    await pace(officer);
    await signIn(officer, staff);
    await officer.goto(`${staff}/api/ready`);
    const app = await createApplication(page);
    await page.goto(`${borrower}/applications/${app.id}?bank=bank-a`);
    await page.getByRole("link", { name: "Review and submit application", exact: true }).click();
    await expect(page).toHaveURL(url(borrower, app.id));
    await expect(
      page.getByRole("region", { name: "Submission readiness", exact: true }),
    ).toContainText("Describe your business");
    await completeSubmissionTasks(page, officer, app.id);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Approval readiness", exact: true }),
    ).toContainText("Simulated business fraud check");
    await submit(page);
    await officer.goto(url(staff, app.id));
    await expect(
      officer.getByRole("button", { name: "Start bank review", exact: true }),
    ).toBeVisible();
    // The command updates review data before the surrounding workspace finishes
    // refreshing. That successful intermediate render must not show a conflict.
    const summaryPattern = new RegExp(`/applications/${app.id}/workspace$`);
    let releaseSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    await officer.route(summaryPattern, async (route) => {
      await summaryGate;
      await route.fallback();
    });
    try {
      const summaryRefresh = officer.waitForRequest(summaryPattern);
      await officer.getByRole("button", { name: "Start bank review", exact: true }).click();
      await summaryRefresh;
      await expect(
        officer.getByRole("button", { name: "Start bank review", exact: true }),
      ).toBeDisabled();
      await expect(
        officer.getByRole("alert").filter({ hasText: "This application changed" }),
      ).toHaveCount(0);
    } finally {
      const resumedSummary = officer.waitForResponse(summaryPattern);
      releaseSummary();
      await resumedSummary;
      await officer.unroute(summaryPattern);
    }
    await officer.getByRole("button", { name: "Request information", exact: true }).click();
    await officer
      .getByLabel("Reason shared with the applicant", { exact: true })
      .selectOption("additional_information");
    await officer.getByLabel("Describe your business", { exact: true }).check();
    await officer
      .getByLabel("Private staff note (optional)", { exact: true })
      .fill("Synthetic internal information-request note.");
    await officer
      .getByLabel("I confirm these tasks need an update from the applicant.", { exact: true })
      .check();
    await officer.getByRole("button", { name: "Send information request", exact: true }).click();
    await expect(
      officer.getByText("Synthetic internal information-request note.", { exact: true }),
    ).toBeVisible();
    await officer.goto(`${staff}/api/ready`);
    await page.reload();
    await expect(
      page.getByText("Additional information is required before a decision.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic internal information-request note.", { exact: true }),
    ).toHaveCount(0);
    await page.goto(url(borrower, app.id, "tasks"));
    await page.getByRole("button", { name: "Describe your business", exact: true }).click();
    await page
      .getByLabel("Your answer", { exact: true })
      .fill("Updated synthetic workshop details requested by the reviewer.");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Answer saved." })).toBeVisible();
    await page.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Answer submitted for bank review." }),
    ).toBeVisible();
    await page.goto(`${borrower}/api/ready`);
    const tasks = await api<TasksView>(officer, "GET", `/${app.id}/tasks`);
    const returned = tasks.tasks.find((task) => task.title === "Describe your business");
    if (!returned) throw new Error("Returned synthetic task missing.");
    await api(officer, "POST", `/${app.id}/tasks/${returned.id}/review`, {
      expectedRevision: returned.revision,
      decision: "completed",
      reason: "Reviewed updated synthetic answer.",
    });
    await completeApprovalFixture(page, officer, app.id);
    await page.goto(url(borrower, app.id));
    await submit(page, true);
    await expect(page.getByText(/^Submission 1 ·/)).toBeVisible();
    await expect(page.getByText(/^Submission 2 ·/)).toBeVisible();
    await officer.goto(url(staff, app.id));
    await officer.getByRole("button", { name: "Start bank review", exact: true }).click();
    await officer.getByRole("button", { name: "Approve application", exact: true }).click();
    await officer.getByLabel("Approved amount (USD)", { exact: true }).fill("19000.25");
    await officer
      .getByLabel("Reason shared with the applicant", { exact: true })
      .selectOption("demo_criteria_met");
    await officer
      .getByLabel("Private staff note (optional)", { exact: true })
      .fill("Synthetic internal approval note.");
    await expect(
      officer.getByRole("button", { name: "Record approval", exact: true }),
    ).toBeDisabled();
    await officer
      .getByLabel(
        "I reviewed the current application and am deliberately recording this simulated decision.",
        { exact: true },
      )
      .check();
    await officer.getByRole("button", { name: "Record approval", exact: true }).click();
    await expect(
      officer.getByRole("heading", { name: "Approval recorded", exact: true }),
    ).toBeVisible();
    await expect(
      officer.getByText("Synthetic internal approval note.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("$19,000.25", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "The bank recorded a simulated approval. Closing requirements and recorded funding are separate steps.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("Synthetic internal approval note.", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Approve application", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Submission readiness", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Closing readiness", exact: true }),
    ).toBeVisible();
    const original = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: /^Submission 1 ·/ }) });
    await original.locator("summary").click();
    await expect(original.getByText("$20,000.00", { exact: true })).toBeVisible();
    const final = await api<ReviewView>(page, "GET", `/${app.id}/review`);
    expect(final.submissions).toHaveLength(2);
    expect(
      final.submissions.every((submission) => submission.facts.requestedAmount === "20000.00"),
    ).toBe(true);
    expect(final.decisions[0]?.approvedAmount).toBe("19000.25");
    expect(final.history.every((event) => event.privateNote === null)).toBe(true);
    await noOverflow(page);
    await noOverflow(officer);
    await page.screenshot({
      path: testInfo.outputPath("synthetic-approved-review.png"),
      fullPage: true,
    });
    await officer.screenshot({
      path: testInfo.outputPath("synthetic-staff-review-history.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("staff-on-behalf submission and stale decision forms require explicit reload before decline", async ({
  page,
  browser,
}) => {
  const pace = paceRequests();
  await pace(page);
  await signIn(page, borrower);
  await page.goto(`${borrower}/api/ready`);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await context.newPage();
    await pace(officer);
    await signIn(officer, staff);
    await officer.goto(`${staff}/api/ready`);
    const app = await createApplication(page);
    await completeSubmissionTasks(page, officer, app.id);
    await officer.goto(url(staff, app.id));
    await submit(officer);
    await officer.getByText(/^Submission 1 ·/).click();
    await expect(
      officer.getByText("Submitted by bank staff on behalf of the applicant.", { exact: true }),
    ).toBeVisible();
    await officer.getByRole("button", { name: "Start bank review", exact: true }).click();
    await officer.getByRole("button", { name: "Decline application", exact: true }).click();
    await officer
      .getByLabel("Reason shared with the applicant", { exact: true })
      .selectOption("demo_criteria_not_met");
    const note = officer.getByLabel("Private staff note (optional)", { exact: true });
    await note.fill("Unsaved synthetic decision rationale.");
    await officer
      .getByLabel(
        "I reviewed the current application and am deliberately recording this simulated decision.",
        { exact: true },
      )
      .check();
    const visible = await api<ReviewView>(officer, "GET", `/${app.id}/review`);
    const pattern = new RegExp(`/applications/${app.id}/review$`);
    await officer.route(pattern, (route) => route.fulfill({ json: visible }));
    await api(officer, "POST", `/${app.id}/review/request-information`, {
      expectedRevision: visible.revision,
      idempotencyKey: randomUUID(),
      reasonCode: "current_evidence_required",
      taskIds: [
        visible.requestableTasks.find((task) => task.title === "Describe your business")?.id,
      ],
    });
    await officer.getByRole("button", { name: "Record decline", exact: true }).click();
    await expect(officer.getByRole("alert")).toContainText("This application changed");
    await expect(note).toHaveValue("Unsaved synthetic decision rationale.");
    await officer.unroute(pattern);
    await officer.getByRole("button", { name: "Reload current application", exact: true }).click();
    await expect(note).toHaveCount(0);
    await completeSubmissionTasks(page, officer, app.id);
    await officer.reload();
    await submit(officer, true);
    await officer.getByRole("button", { name: "Start bank review", exact: true }).click();
    await officer.getByRole("button", { name: "Decline application", exact: true }).click();
    await officer
      .getByLabel("Reason shared with the applicant", { exact: true })
      .selectOption("demo_criteria_not_met");
    await officer
      .getByLabel(
        "I reviewed the current application and am deliberately recording this simulated decision.",
        { exact: true },
      )
      .check();
    await officer.getByRole("button", { name: "Record decline", exact: true }).click();
    await expect(officer.getByText("Decline recorded", { exact: true })).toBeVisible();
    await page.goto(url(borrower, app.id));
    await expect(
      page.getByRole("status").filter({ hasText: "This application is closed" }),
    ).toBeVisible();
    await expect(
      page.getByText("The application does not meet the simulated review criteria.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/^Submission 1 ·/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit application", exact: true })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

test("unfinished setup can be deliberately withdrawn without opening the task portal", async ({
  page,
}, testInfo) => {
  await paceRequests()(page);
  await signIn(page, borrower);
  await page.goto(`${borrower}/api/ready`);
  const app = await createApplication(page, false);
  await page.goto(url(borrower, app.id, "setup"));
  await page
    .getByRole("link", { name: "Review status or withdraw this application", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Submit application", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Withdraw application", exact: true }).click();
  await page
    .getByLabel("Withdrawal reason", { exact: true })
    .selectOption("application_no_longer_needed");
  await page
    .getByLabel("I understand this application will be closed and cannot be reopened.", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Withdraw application", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Application withdrawn", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The application is no longer needed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw application", exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This application is closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Application withdrawn", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-withdrawn-draft.png"),
    fullPage: true,
  });
});
