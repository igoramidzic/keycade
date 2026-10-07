import { randomUUID } from "node:crypto";
import type { ApplicationSetup, ReviewView, TasksView, TaskView } from "@keycade/contracts";
import { expect, type Page } from "@playwright/test";

// All credentials remain inside the browser and all fixture records are synthetic.
export async function workflowApi<T>(
  page: Page,
  method: string,
  suffix: string,
  body?: object,
): Promise<T> {
  return page.evaluate(
    async ({ method, suffix, body }) => {
      const session = await (await fetch("/api/v1/auth/session")).json();
      const response = await fetch(`/api/v1/banks/${session.bank.id}${suffix}`, {
        method,
        headers: { "Content-Type": "application/json", "x-csrf-token": session.csrfToken },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          `Synthetic closing fixture failed (${response.status}, ${error.error?.code ?? "unknown"}).`,
        );
      }
      return response.json();
    },
    { method, suffix, body },
  );
}

export async function prepareReview(
  applicant: Page,
  officer: Page,
  options: { checkTimeoutMs?: number } = {},
) {
  let app = await workflowApi<ApplicationSetup>(applicant, "POST", "/applications", {
    idempotencyKey: randomUUID(),
  });
  for (const step of [
    {
      step: "business_name",
      currentStep: "amount",
      answers: { businessName: `Synthetic Closing Workshop ${randomUUID().slice(0, 8)}` },
    },
    { step: "amount", currentStep: "purpose", answers: { requestedAmount: "20000.00" } },
    {
      step: "purpose",
      currentStep: "industry",
      answers: { purpose: "Synthetic closing demonstration" },
    },
    { step: "industry", currentStep: "review", answers: {}, skip: true },
  ])
    app = await workflowApi<ApplicationSetup>(applicant, "PATCH", `/applications/${app.id}/setup`, {
      expectedRevision: app.revision,
      ...step,
    });
  app = await workflowApi<ApplicationSetup>(
    applicant,
    "POST",
    `/applications/${app.id}/setup/finish`,
    { expectedRevision: app.revision, idempotencyKey: randomUUID() },
  );
  const base = `/applications/${app.id}`;
  const tasks = await workflowApi<TasksView>(applicant, "GET", `${base}/tasks`);
  for (let task of tasks.tasks.filter(
    (task) => task.required && task.stage === "submission" && task.inputKind === "answer",
  )) {
    task = await workflowApi<TaskView>(applicant, "PATCH", `${base}/tasks/${task.id}/answer`, {
      expectedRevision: task.revision,
      answer: "Synthetic workshop repairs demonstration equipment.",
    });
    task = await workflowApi<TaskView>(applicant, "POST", `${base}/tasks/${task.id}/submit`, {
      expectedRevision: task.revision,
    });
    await workflowApi(officer, "POST", `${base}/tasks/${task.id}/review`, {
      expectedRevision: task.revision,
      decision: "completed",
      reason: "Reviewed synthetic closing fixture evidence.",
    });
  }
  const currentTasks = await workflowApi<TasksView>(applicant, "GET", `${base}/tasks`);
  for (const task of currentTasks.tasks.filter((task) =>
    ["synthetic_business_identifier", "synthetic_personal_identifier"].includes(task.inputKind),
  ))
    await workflowApi(applicant, "POST", `${base}/tasks/${task.id}/identifier`, {
      expectedRevision: task.revision,
      expectedInputRevision: task.secureInput?.revision ?? 0,
      value: "000000001",
    });
  const reviewed = await workflowApi<TasksView>(officer, "GET", `${base}/tasks`);
  for (const task of reviewed.tasks.filter(
    (task) =>
      task.required &&
      task.stage === "approval" &&
      task.inputKind === "answer" &&
      !["completed", "waived"].includes(task.state),
  ))
    await workflowApi(officer, "POST", `${base}/tasks/${task.id}/waive`, {
      expectedRevision: task.revision,
      reason: "Explicit synthetic closing fixture waiver.",
    });
  await expect
    .poll(
      async () =>
        (await workflowApi<ReviewView>(officer, "GET", `${base}/review`)).readiness.gates
          .find((gate) => gate.stage === "approval")
          ?.blockers.filter((blocker) => blocker.kind !== "lifecycle").length,
      { timeout: options.checkTimeoutMs ?? 30000, intervals: [2000] },
    )
    .toBe(0);
  let review = await workflowApi<ReviewView>(applicant, "GET", `${base}/review`);
  review = await workflowApi<ReviewView>(applicant, "POST", `${base}/review/submit`, {
    expectedRevision: review.revision,
    idempotencyKey: randomUUID(),
  });
  await workflowApi(officer, "POST", `${base}/review/start-review`, {
    expectedRevision: review.revision,
    idempotencyKey: randomUUID(),
  });
  return app;
}
