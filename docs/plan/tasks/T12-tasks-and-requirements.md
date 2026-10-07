# T12 — Task workflows and versioned product requirements

Dependencies: T11. Read [task rules](../03-domain-and-access.md#tasks-and-requirements).

## Outcome

Every participant sees their next actions, and staff can review evidence against explicit requirements.

## Scope

- Add task, assignment, answer/evidence-link, review, waiver, due-date, and requirement-rule records with revisions and audit events.
- Implement `open`, `submitted`, `needs_changes`, `completed`, `waived`, and `cancelled` transitions with authorized actors.
- Add simple versioned declarative demo rules per product, amount/entity details, and participant facts; distinguish submission, approval, and closing stages.
- Reconcile rules idempotently after relevant changes, preserve manual tasks/history, and explain why a task applies.
- Add task lists/detail, staff review actions, manual tasks, progress counts, and private owner field tasks. File and signature evidence adapters arrive in T13/T17.
- Wire T11 participant scope policies to current task records. Validate every delegated task ID within the same bank/application and the inviter’s authority; T11 rejects nonempty grant lists until this exists. Extend participant removal to unassign unfinished tasks transactionally while preserving prior authorship, using its revocation/unassignment markers.

## Acceptance criteria

- Different sample products/amounts can produce different checklists without UI hard-coded thresholds.
- Unknown EIN/industry can produce a later task without preventing minimal intake.
- Re-running rules creates no duplicate tasks; per-subject keys keep two owners' requirements separate. Input changes add/cancel applicable requirements without destroying prior evidence or waivers.
- Re-applicable cancelled requirements receive a new occurrence/revision under the same stable identity. Evidence reuse requires an explicit current-evidence policy; waivers require renewed confirmation. Test amount changes and owner removal/re-addition.
- Assignees submit; staff completes/returns; waiver requires a reason. Uploading or editing an answer alone cannot imply approval.
- Restricted participants see only permitted tasks/evidence/counts; owner-private fields remain private. Removing an assignee leaves unfinished tasks unassigned immediately, including after that person is reinvited; historical authorship and completed work remain intact.
- Concurrent submissions/reviews reject stale revisions. Applicable completed/waived tasks drive progress accurately.

## Validation

Unit-test rule reconciliation, stage gates, task transitions, waiver and evidence-revision rules. Use PostgreSQL for assignment/scope and concurrent review tests. Demonstrate a staff-added task, borrower submission, return for changes, and completion.

Defer a visual rule builder and live bank policy to future work. T16 combines requirements with checks into full readiness.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
