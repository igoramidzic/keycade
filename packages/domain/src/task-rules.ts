import type { TaskProgress, TaskStage, TaskState } from "@keycade/contracts";
import type { RequirementRule } from "@keycade/db";

export const taskStages: readonly TaskStage[] = ["submission", "approval", "closing"];
export const settledTaskStates = new Set<TaskState>(["completed", "waived", "cancelled"]);
/** Demo policy data is persisted per product/version and snapshotted per application. */
export function demoRequirementRules(productSlug: string): RequirementRule[] {
  const common: RequirementRule[] = [
    {
      key: "entity-details",
      title: "Confirm business entity details",
      description:
        "Describe the synthetic business entity type, such as a corporation or LLC. Do not enter identifiers.",
      reason: "Entity details are collected after minimal initial setup, before approval.",
      stage: "approval",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "entity_unknown",
    },
    {
      key: "business-overview",
      title: "Describe your business",
      description:
        "Give a short description of your business and how it operates. Use synthetic information for this demo.",
      reason: "A business overview is required for application submission.",
      stage: "submission",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "business_known",
    },
    {
      key: "industry",
      title: "Confirm your industry",
      description:
        "Tell the bank which industry best describes the business. Use synthetic information for this demo.",
      reason: "Industry was not provided during initial setup.",
      stage: "approval",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "industry_unknown",
    },
    {
      key: "tax-document-readiness",
      title: "Confirm business identifier readiness",
      description:
        "Enter confirmed or needs_help to indicate whether synthetic business identifier documentation is available. Use the separate private identifier task to provide registered demo input; never enter an EIN or SSN here.",
      reason:
        "Initial setup does not collect business identifiers; this later approval requirement keeps intake short.",
      stage: "approval",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "identifier_unknown",
    },
    {
      key: "owner-confirmation",
      title: "Confirm owner information readiness",
      description:
        "Private synthetic owner task: enter confirmed or needs_help to indicate whether you can provide demo owner information later. Do not enter personal identifiers.",
      reason: "Each disclosed owner has a separate private information requirement.",
      stage: "approval",
      required: true,
      visibility: "private",
      subject: "owner",
      condition: "always",
    },
    {
      key: "funding-confirmation",
      title: "Confirm simulated funding readiness",
      description:
        "Confirm that you understand funding in this demonstration records a simulation and moves no money.",
      reason: "The closing checklist requires acknowledgement of simulated funding.",
      stage: "closing",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "always",
    },
  ];
  common.push({
    key: "use-of-funds",
    title: "Explain your use of funds",
    description: "Describe the planned use of the requested funds using synthetic details.",
    reason:
      productSlug === "equipment-finance"
        ? "Equipment finance requires a use-of-funds explanation for every request."
        : "Requests of $100,000 or more require a detailed use-of-funds explanation.",
    stage: "approval",
    required: true,
    visibility: "shared",
    subject: "application",
    condition: "amount_at_least",
    amount: productSlug === "equipment-finance" ? "0.00" : "100000.00",
  });
  if (productSlug === "equipment-finance")
    common.push({
      key: "equipment-description",
      title: "Describe the equipment",
      description: "Describe the synthetic equipment to be financed.",
      reason: "The equipment finance product requires an equipment description.",
      stage: "submission",
      required: true,
      visibility: "shared",
      subject: "application",
      condition: "always",
    });
  return common;
}
export type RuleFacts = {
  requestedAmount: string | null;
  businessName: string | null;
  industryCode: string | null;
  owners: { id: string; userId: string | null; displayName?: string }[];
};
export type ApplicableRequirement = RequirementRule & {
  stableKey: string;
  subjectUserId: string | null;
  subjectRelationshipId: string | null;
  inputFingerprint: string;
};
const cents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};
export function evaluateRequirementRules(
  rules: readonly RequirementRule[],
  facts: RuleFacts,
): ApplicableRequirement[] {
  return rules.flatMap((rule) => {
    const applicable =
      rule.condition === "always" ||
      rule.condition === "identifier_unknown" ||
      rule.condition === "entity_unknown" ||
      (rule.condition === "business_known" && !!facts.businessName) ||
      (rule.condition === "industry_unknown" && !facts.industryCode) ||
      (rule.condition === "amount_at_least" &&
        facts.requestedAmount !== null &&
        cents(facts.requestedAmount) >= cents(rule.amount ?? "0"));
    if (!applicable) return [];
    return (rule.subject === "owner" ? facts.owners : [{ id: "application", userId: null }]).map(
      (subject) => ({
        ...rule,
        title:
          rule.subject === "owner" && "displayName" in subject && subject.displayName
            ? `${rule.title} — ${subject.displayName}`.slice(0, 160)
            : rule.title,
        inputFingerprint: JSON.stringify([
          rule.key,
          subject.id,
          subject.userId,
          rule.condition === "amount_at_least"
            ? facts.requestedAmount
            : rule.condition === "business_known"
              ? facts.businessName
              : null,
        ]),
        stableKey: `${rule.key}:${subject.id}`,
        subjectUserId: subject.userId,
        subjectRelationshipId: rule.subject === "owner" ? subject.id : null,
      }),
    );
  });
}
export type ProgressTask = {
  state: TaskState;
  stage: TaskStage;
  required: boolean;
  evidenceRevision: number;
  reviewedEvidenceRevision: number | null;
};
/** Lender-reviewed (or waived) current evidence: the bar for approval, checks and closing. */
export function taskPasses(task: ProgressTask) {
  return (
    task.state === "waived" ||
    (task.state === "completed" &&
      task.evidenceRevision > 0 &&
      task.reviewedEvidenceRevision === task.evidenceRevision)
  );
}
/** The assignee completed this evidence; it now waits only for optional lender review. */
export function taskAwaitingReview(task: ProgressTask) {
  return task.state === "submitted" && task.evidenceRevision > 0;
}
/** Completed from the client's point of view: progress and the client's submission gate. */
export function taskDone(task: ProgressTask) {
  return taskPasses(task) || taskAwaitingReview(task);
}
export function calculateTaskProgress(tasks: readonly ProgressTask[]): TaskProgress {
  const count = (items: readonly ProgressTask[]) => ({
    total: items.length,
    completed: items.filter(taskDone).length,
    required: items.filter((x) => x.required).length,
    requiredCompleted: items.filter((x) => x.required && taskDone(x)).length,
  });
  const current = tasks.filter((task) => task.state !== "cancelled");
  return {
    ...count(current),
    byStage: taskStages.map((stage) => ({
      stage,
      ...count(current.filter((task) => task.stage === stage)),
    })),
  };
}
/** Requirement-only gate; T16/T19 additionally enforce setup, checks, authority and application status. */
export function requirementsPassStage(tasks: readonly ProgressTask[], stage: TaskStage) {
  return tasks.every(
    (task) =>
      task.state === "cancelled" ||
      !task.required ||
      taskStages.indexOf(task.stage) > taskStages.indexOf(stage) ||
      taskPasses(task),
  );
}
export function taskTransitionAllowed(
  state: TaskState,
  operation: "answer" | "submit" | "review" | "waive",
) {
  if (operation === "answer") return state !== "cancelled";
  if (operation === "submit") return state === "open" || state === "needs_changes";
  if (operation === "review") return state === "submitted";
  return state === "open" || state === "needs_changes" || state === "submitted";
}
