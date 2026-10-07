# T19 — Submission, bank review, and decisions

Dependencies: T10, T12, T16. Read [application lifecycle](../03-domain-and-access.md#application-lifecycle).

## Outcome

Applicants submit a complete-enough package, and staff request changes or record a deliberate decision.

## Scope

- Implement submit/resubmit, claim/start review, request information, approve, decline, and pre-funding withdrawal commands with explicit actor/guard checks.
- Persist submission snapshots and decision records containing safe version references, approved terms, reason, actor, and time.
- Lock material application fields during submission/review; reopening for information makes a new editable revision while retaining prior submissions.
- Add borrower confirmation/status views and bank review actions with explanatory blockers and conflicts.
- Emit audit/outbox events for downstream notifications and closing. Readiness remains the shared T16 policy, not a copy in UI code.

## Acceptance criteria

- A draft cannot jump directly to approval/funding; illegal/unauthorized transitions fail on the server.
- Submission gates differ from approval gates and report specific unmet requirements.
- Staff can return an application for information, then review a fresh submission without overwriting the old snapshot.
- Approval and decline require a recorded human decision; a fake check cannot make the decision.
- Concurrent decisions use revision guards and produce one final decision for the current review version.
- Shared-business changes through another application cannot mutate a submitted/approved snapshot or expose unrelated application data.
- Withdrawal cancels now-inapplicable work/reminders while preserving history.

## Validation

Test all allowed/disallowed transitions, stage gates, stale decisions, transaction rollback, cross-application snapshot isolation, and borrower-safe reasons. Demonstrate submit → request information → resubmit → approve and a separate decline/withdraw scenario.

Do not create a funded account merely because an application was approved. Terms amendments and real decision-notice policy are later work.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
