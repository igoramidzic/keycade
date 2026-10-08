# T19 — Submission, bank review, and decisions

V2 amendment — October 8, 2026, **implemented; acceptance recorded in the linked v2 tasks**: [V2-04](../v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) introduces explicit reviewed adoption of extracted application facts with immutable provenance. Its acceptance preserves submitted/decided snapshots and lifecycle locks; lender adoption is not a loan decision or task acceptance. [V2-02](../v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) keeps submission reachable contextually after removing borrower tabs. Existing state transitions remain authoritative.

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
- Incomplete setup blocks submission, including staff submission on behalf. Setup completion alone does not submit the application or satisfy remaining submission tasks/checks.
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

Implemented October 7, 2026. Migration `0017_odd_flatman` adds append-only submission snapshots, review events, decisions and actor-bound command receipts. Commands serialize on the application and enforce current participation/staff membership, expected revision, current stage and explicit human confirmation. Submission and approval use the shared readiness policy. Information requests reopen selected tasks and create a fresh editable revision; immutable prior packages remain visible. Material input fingerprints protect decisions from drift, including changes made through another application's shared business. Public reason codes are separate from staff-only notes. Withdrawal cancels inapplicable jobs, envelopes and reminders.

Both dashboards expose review history and current actions, including withdrawal before setup is complete. Staff may submit on behalf only after the same setup/submission guards pass. Borrowers see their own safe history; limited collaborators do not gain review access. Approval does not create an account.

Validation: 12 focused PostgreSQL review tests and 4 new HTTP cases across Fastify/native Workers passed. Desktop/mobile review journeys passed 6/6: submit → information request → resubmit → explicit approval, stale decision and decline, draft withdrawal, private-note isolation and submitted-on-behalf history. Full checkpoint checks and deployment evidence are recorded below.


## Checkpoint validation

October 7, 2026: `pnpm check` passed Biome/browser boundaries, all 12 workspace typechecks plus root TypeScript, and 272 unit tests in 22 files. `pnpm test:integration` passed 326 PostgreSQL tests in 35 suites. `pnpm build` passed all 12 workspaces; borrower/console retain non-failing bundle-size warnings. Native API/jobs Wrangler dry runs passed. D03 inbox browser tests passed 8/8; review/navigation regression run passed 24/24 (6 review plus 18 workspace cases). Tests use disposable local databases and synthetic data; production acceptance is recorded separately.
