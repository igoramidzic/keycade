import { randomUUID } from "node:crypto";
import { readEnvironment } from "@keycade/config/server";
import type { ParticipantsWorkspace, TasksView } from "@keycade/contracts";
import { expect, type Page, test } from "@playwright/test";
import { workflowApi } from "./closing-helpers";

const env = readEnvironment();
const borrower = `http://127.0.0.1:${env.BORROWER_PORT ?? 3001}`;
const staff = `http://127.0.0.1:${env.BANK_CONSOLE_PORT ?? 3002}`;
const applicationId = "60000000-0000-4000-8000-000000000001";
const base = `/applications/${applicationId}`;
const dashboard = `${borrower}${base}?bank=bank-a`;
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
async function openKit(page: Page) {
  const kit = page.getByLabel("Demo scenario kit", { exact: true });
  if (!(await kit.isVisible()))
    await page.getByRole("button", { name: "Show demo kit", exact: true }).click();
  await expect(kit).toBeVisible();
  return kit;
}
async function closeKit(page: Page) {
  const kit = page.getByLabel("Demo scenario kit", { exact: true });
  await kit.getByRole("button", { name: "Hide demo kit", exact: true }).click();
  await expect(kit).not.toBeVisible();
}

test("a denied task mutation immediately clears the entire cached application dashboard", async ({
  page,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  await page.goto(dashboard);
  await page.clock.install();
  const tasks = page.getByRole("region", { name: "Application tasks", exact: true });
  await tasks.getByRole("button", { name: "Describe your business", exact: true }).click();
  await tasks.locator('[id^="task-answer-"]').fill("Unsaved synthetic answer before access loss.");
  const pattern = /\/applications\/[^/]+\/tasks\/[^/]+\/answer$/;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "FORBIDDEN", message: "Your task access changed." } },
    }),
  );
  await tasks.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your task access changed.");
  await page.clock.fastForward(30_001);
  await expect(page.getByRole("alert")).toContainText("Your task access changed.");
  await expect(tasks).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Application details", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Synthetic Cedar Workshop", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[id^="task-answer-"]')).toHaveCount(0);
  await expect(page.getByText("$10,000", { exact: true })).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(tasks.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.locator('[id^="task-answer-"]')).toHaveCount(0);
});

test("demo uploads follow the visible private task or document page and restore the task destination on return", async ({
  page,
  browser,
}) => {
  await signIn(page, borrower, "borrower@example.test");
  const staffContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const officer = await staffContext.newPage();
    await signIn(officer, staff, "officer-a@example.test");
    await officer.goto(`${staff}/api/ready`);
    const people = await workflowApi<ParticipantsWorkspace>(officer, "GET", `${base}/participants`);
    const applicant = people.participants.find(
      (person) => person.email === "borrower@example.test",
    );
    if (!applicant) throw new Error("Expected the synthetic applicant.");
    const ownerName = `Synthetic dashboard owner ${randomUUID().slice(0, 8)}`;
    await workflowApi(officer, "POST", `${base}/participants/relationships`, {
      idempotencyKey: randomUUID(),
      displayName: ownerName,
      kind: "owner",
      userId: applicant.userId,
      ownershipPercent: "10",
    });
    const tasks = await workflowApi<TasksView>(officer, "GET", `${base}/tasks`);
    const privateTask = tasks.tasks.find(
      (task) =>
        task.visibility === "private" &&
        task.subjectUserId === applicant.userId &&
        task.title.includes(ownerName) &&
        task.inputKind === "answer",
    );
    if (!privateTask) throw new Error("Expected a synthetic private owner task.");
    await page.goto(dashboard);
    await page.getByRole("button", { name: privateTask.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Task documents", exact: true })).toBeVisible();
    let kit = await openKit(page);
    await expect(
      kit.getByText(`Upload destination: ${privateTask.title}.`, { exact: true }),
    ).toBeVisible();
    await closeKit(page);

    await page.getByRole("link", { name: "View documents", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
    kit = await openKit(page);
    await expect(
      kit.getByText("Upload destination: Application documents.", { exact: true }),
    ).toBeVisible();
    await expect(
      kit.getByText(`Upload destination: ${privateTask.title}.`, { exact: true }),
    ).toHaveCount(0);
    await closeKit(page);
    await page.getByRole("link", { name: "Back to task dashboard", exact: true }).click();
    await expect(
      page.getByRole("button", { name: privateTask.title, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    kit = await openKit(page);
    await expect(
      kit.getByText(`Upload destination: ${privateTask.title}.`, { exact: true }),
    ).toBeVisible();
    await closeKit(page);

    for (const action of ["View activity", "Review and submit application"]) {
      await page.getByRole("link", { name: action, exact: true }).click();
      kit = await openKit(page);
      await expect(
        kit.getByText("Open Documents or an uploadable task to enable Upload.", { exact: true }),
      ).toBeVisible();
      await expect(
        kit.getByRole("button", { name: "Upload Guarantor identity summary", exact: true }),
      ).toBeDisabled();
      await closeKit(page);
      await page.getByRole("link", { name: "Back to task dashboard", exact: true }).click();
    }
  } finally {
    await staffContext.close();
  }
});
