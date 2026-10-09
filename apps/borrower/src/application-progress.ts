import type { ApplicationPortal } from "@keycade/contracts";

export type ProgressStep = {
  key: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "stopped" | "previous";
  description: string;
};
export const lifecycleLabels: Record<string, string> = {
  setup_completed: "Initial Application Form completed",
  submitted: "Application received",
  in_review: "Underwriting started",
  needs_information: "More information requested",
  approved: "Credit Decision approved",
  declined: "Credit Decision declined",
  withdrawn: "Application withdrawn",
  closing: "Closing started",
  funded: "Funding recorded",
};

// A projection of persisted state and events, never a second workflow or approval score.
export function applicationProgress(
  application: Pick<
    ApplicationPortal,
    "status" | "setupStatus" | "timelineEvents" | "fundedAccountId" | "accessScope"
  >,
): ProgressStep[] {
  const { status, timelineEvents } = application;
  const reached = (value: string) => timelineEvents.some((event) => event.status === value);
  const later = ["approved", "closing", "funded"].includes(status);
  const terminal = status === "declined" || status === "withdrawn";
  const step = (
    key: string,
    label: string,
    state: ProgressStep["state"],
    description: string,
  ): ProgressStep => ({ key, label, state, description });
  const steps = [
    step(
      "setup",
      "Initial Application Form",
      application.setupStatus === "completed" ? "complete" : terminal ? "stopped" : "current",
      application.setupStatus === "completed" ? "Setup complete" : "Setup unfinished",
    ),
    step(
      "application",
      "Application In Progress",
      ["collecting_information", "needs_information"].includes(status)
        ? "current"
        : reached("submitted") || ["submitted", "in_review"].includes(status) || later
          ? "complete"
          : terminal
            ? "stopped"
            : "upcoming",
      status === "needs_information"
        ? "Needs your action"
        : ["submitted", "in_review"].includes(status) || reached("submitted") || later
          ? "Application received"
          : "Complete your available tasks",
    ),
    step(
      "underwriting",
      "Underwriting",
      status === "in_review" || status === "submitted"
        ? "current"
        : later
          ? "complete"
          : reached("in_review")
            ? "previous"
            : terminal
              ? "stopped"
              : "upcoming",
      status === "submitted"
        ? "Awaiting lender review"
        : status === "in_review"
          ? "Lender review in progress"
          : reached("in_review") && !later
            ? "Previous review is preserved in history"
            : later
              ? "Review complete"
              : "Lender review",
    ),
    step(
      "decision",
      "Credit Decision",
      later ? "complete" : reached("approved") ? "previous" : terminal ? "stopped" : "upcoming",
      later
        ? "Approved"
        : reached("approved")
          ? "Approval recorded before withdrawal"
          : status === "declined"
            ? "Declined"
            : terminal
              ? "Withdrawn"
              : "Awaiting a decision",
    ),
    step(
      "closing",
      "Closing",
      status === "closing"
        ? "current"
        : status === "funded"
          ? "complete"
          : reached("closing")
            ? "previous"
            : terminal
              ? "stopped"
              : "upcoming",
      status === "closing"
        ? "Complete remaining signatures and conditions"
        : status === "funded"
          ? "Closing complete"
          : reached("closing")
            ? "Closing started before withdrawal"
            : terminal
              ? "Not reached"
              : "Closing requirements follow approval",
    ),
    step(
      "funding",
      "Funding",
      status === "funded" ? "complete" : terminal ? "stopped" : "upcoming",
      status === "funded"
        ? "Funding recorded"
        : terminal
          ? "Not reached"
          : "Funding has not been recorded",
    ),
  ];
  if (application.accessScope === "full")
    steps.push(
      step(
        "booked",
        "Loan Booked",
        status === "funded" && application.fundedAccountId
          ? "complete"
          : terminal
            ? "stopped"
            : "upcoming",
        status === "funded" && application.fundedAccountId
          ? "Loan account recorded"
          : terminal
            ? "Not reached"
            : "Account recorded after funding",
      ),
    );
  return steps;
}
