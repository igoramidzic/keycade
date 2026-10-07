# T16 — Identity/fraud checks and application readiness

Dependencies: T12, T14, T15. Read [domain](../03-domain-and-access.md) and [job behavior](../04-integrations-and-jobs.md).

## Outcome

Required identifiers and evidence drive background checks and an explainable readiness summary.

## Scope

- Add private identifier-entry tasks using T15's encrypted service and explicit authorization prerequisites.
- Implement delayed fake identity/fraud adapters, prerequisite evaluation, input-version tracking, and visible execution/outcome states.
- Reconcile missing-document requirements against current reviewed evidence; avoid duplicate work already represented by T12 tasks.
- Add bank checks/readiness panels and borrower-safe next actions. Show staff-only evidence and simulation labels appropriately.
- Define stage-aware submission, approval, and closing gate evaluation, including permitted waivers and staff resolutions of non-clear outcomes.

## Acceptance criteria

- Creating a draft with missing EIN/SSN leaves checks waiting and does not block minimal intake. Supplying the final prerequisite starts one current run.
- A later-stage check does not block an earlier gate merely because it exists. Each blocker identifies its stage and reason.
- Required current evidence/checks must pass or have an explicitly permitted, audited resolution; failed, stale, running, and unknown results never count as clear.
- Simulated risk flags do not automatically approve or decline an application.
- New/removed/replaced documents reconcile requirements without losing manual tasks or review history.
- Old check results cannot overwrite newer identifiers or a frozen decision snapshot; retry and resolution actions enforce bank authorization.

## Validation

Test missing prerequisites, all result categories, stage-specific gates, staff-resolution policy, stale input/results, worker restart, and duplicate triggers. Run two-owner fixtures to verify separate private tasks and checks. Demonstrate a clear application and one requiring staff review.

Defer credit scoring, automatic decisioning, and real KYC/KYB/tax checks. T19 consumes readiness to control submission and decisions.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
