import type { ReviewAction, ReviewActionInput } from "@keycade/ui/components/review-action-form";
import type { ReviewReasons } from "@keycade/ui/components/review-manager";

export function reviewReasons(labels: Record<string, string>): ReviewReasons {
  const options = (codes: string[]) =>
    codes.map((value) => ({ value, label: labels[value] ?? value }));
  return {
    "request-information": options(["additional_information", "current_evidence_required"]),
    approve: options(["demo_criteria_met"]),
    decline: options(["demo_criteria_not_met", "unable_to_verify_information"]),
    withdraw: options(["applicant_requested", "application_no_longer_needed"]),
  };
}

export function reviewCommand(
  action: ReviewAction,
  input: ReviewActionInput,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return {
    expectedRevision,
    idempotencyKey,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.privateNote?.trim() ? { privateNote: input.privateNote.trim() } : {}),
    ...(action === "request-information" ? { taskIds: input.taskIds } : {}),
    ...(action === "approve" ? { approvedAmount: input.approvedAmount } : {}),
    ...(["approve", "decline"].includes(action) ? { humanDecisionConfirmed: input.confirmed } : {}),
  };
}
