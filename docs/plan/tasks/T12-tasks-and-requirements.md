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
- The October 7 reference layout shows tasks immediately on application entry, with a wider task column on the left and application details on the right at desktop sizes. Mobile stacks the regions without horizontal overflow. Task detail expands beneath its row; switching or collapsing a task protects unsaved entries.

## Validation

Unit-test rule reconciliation, stage gates, task transitions, waiver and evidence-revision rules. Use PostgreSQL for assignment/scope and concurrent review tests. Demonstrate a staff-added task, borrower submission, return for changes, and completion.

Defer a visual rule builder and live bank policy to future work. T16 combines requirements with checks into full readiness.

## Implementation record

Done — implemented and verified October 7, 2026.

- Added Drizzle migrations `0008_tiny_mesmero.sql`, `0009_unique_talisman.sql`, and `0010_cool_hitman.sql` for versioned product rules, pinned application policies, task occurrences, immutable answers, reviews, and assignment history; bank/application foreign keys prevent cross-application links. Owner relationships now support non-destructive inactivation/restoration.
- Declarative rules cover product variants, exact requested amounts, missing industry/entity/identifier readiness, and independent owner subjects. UI thresholds are absent. Rules reconcile transactionally and idempotently; existing records initialize on authorized reads with stable application lock ordering. Manual requests survive reconciliation.
- Evidence reuse policy is `never`. Relevant fact changes or reapplicable cancelled requirements start a new open occurrence. Old answers/reviews/waivers remain inspectable. Editing a settled answer reopens review; saving and submission never imply approval.
- Staff can add/assign tasks, set due dates, return submissions, complete reviewed answers, and waive with a reason. All conflicting mutations check task revision. Both HTTP transports expose the same validated task/owner commands and OpenAPI responses.
- Borrower/staff Tasks screens and summaries show permitted progress by stage, reasons, current answers, and history. Invitations support validated task grants. Revocation clears unfinished assignments transactionally without erasing prior authorship or restoring work on reinvitation. Owner linking is first-link-only to a current participant, independent of access grants.
- Private owner and business identifier-readiness inputs accept only synthetic confirmation values. Narrative answers are fictional demo information; no identifier collection, document upload, signature adapter, or actual readiness/decision flow is claimed. T13/T17 own evidence adapters; T16/T19 combine stage requirements with checks and human lifecycle commands.

### Try it locally

1. Apply migrations with `pnpm db:migrate`, then run `pnpm dev`.
2. At the bank console, sign in as `officer-a@example.test`, open Synthetic Cedar Workshop, and choose **Tasks → Add task**. Enter fictional instructions, assign **Synthetic Borrower**, and create it.
3. In a separate borrower session, sign in as `borrower@example.test`, open the same application's **Tasks**, and open the request. **Save answer** retains a draft; **Submit for review** sends it to the bank.
4. In the bank session, reload/open the task, enter a review reason, and **Return for changes**. Revise and resubmit as the borrower, then **Complete task** as staff. Inspect **Task history** and the progress counts.
5. For private owner tasks, record an owner under **People/Participants**, link it to an existing participant, and assign its private task to that person. Other collaborators cannot read the task or count it. Marking the relationship inactive and restoring it creates a new occurrence requiring fresh evidence and review.

### Validation record

All selected acceptance criteria are verified. Commands used the repository-local Node 24.21.0 runtime and pnpm 10.34.6.

- `pnpm check`: passed Biome/browser-boundary checks, all 12 workspace typechecks plus root TypeScript, and **208 unit tests in 11 files**.
- `pnpm build`: all 12 workspace builds passed. Borrower/staff Vite bundles produce non-fatal >500 kB chunk advisories; splitting them is a later performance refinement.
- `pnpm test:integration`: **187 tests in 22 files passed** against disposable real PostgreSQL databases. Coverage includes fresh/upgrade migrations, tenant constraints, duplicate reconciliation, pinned policy versions, second-product differences, amount and owner reactivation, no waiver/evidence reuse, scoped progress, concurrent submit/review conflicts, owner linking, both HTTP adapters, and revocation/reinvitation.
- `pnpm test:e2e tasks.spec.ts borrower-workspace.spec.ts staff-workspace.spec.ts`: **32/34 initially passed**. Both failures were a portal-transition test reading dashboard badges before the detail view mounted. Added an explicit detail-heading wait; `pnpm test:e2e borrower-workspace.spec.ts --grep 'portal polling replaces'` then passed **2/2**. Thus all 34 selected journeys passed, including desktop/mobile task create → save → submit → return → resubmit → complete.
- `pnpm test:e2e participants.spec.ts task-conflicts.spec.ts`: **8/8 passed**. Stale task edits preserve entered values until explicit reload; participant journeys retain verified email acceptance and current authorization.
- After the final assignment-lifecycle permission fix, `pnpm test:e2e tasks.spec.ts task-conflicts.spec.ts`: **6/6 passed**, and the full `pnpm check`, `pnpm build`, and PostgreSQL suite above passed again.
- Explicitly inspected synthetic desktop staff-review and mobile borrower-task screenshots from `.local/e2e-l4DukK`; readable layout and no horizontal overflow. Final task browser results are in ignored `.local/e2e-oYEMBL`; invitation/conflict results are in `.local/e2e-GjxaFa`.
- `pnpm db:migrate` applied the additive migrations to the existing local database; `pnpm db:status` passed real SQL/schema checks. `GET http://127.0.0.1:4000/api/ready` returned HTTP 200 with database and worker ready. Existing data was preserved.

Final review found and fixed one authorization edge case: retained completed/waived assignee IDs could otherwise act as new grants after reinvitation. Assignment generation snapshots now distinguish current authority from historical authorship. Tests verify empty-scope reinvites cannot read/edit/count old tasks, explicit history grants permit reading only, and fresh same-clock assignments work. No hosted deployment was performed.

## Dashboard reference layout — October 7, 2026

The user's image requested a wider workspace, tasks on the left, and details on the right. The borrower shell now uses up to 1440px, with a 1.6:1 task/sidebar split from the desktop breakpoint. Both application entry and `/tasks` show the checklist immediately. The sidebar keeps authorized amount, product, purpose, stage, setup status, and update time together. Application selection uses a two-column desktop card grid while sign-in, setup, and closed summaries remain narrow.

The shared task list now has compact status-icon accordion rows grouped by personal/private versus shared business work. Answers, staff review, assignments, and history expand directly below the selected row. An inline Keep editing / Discard changes prompt protects unsaved entries during row switches and collapse. Default shadcn styles and visible simulation labels remain. The document sidebar explains the current unavailable state; T13 uploads are still deferred.

Validation:

- `pnpm check`: Biome, browser boundaries, all workspace/root typechecks, and **208 unit tests** passed. `pnpm build`: all **12 workspace builds** passed, with the existing non-fatal Vite chunk-size advisories.
- `pnpm test:e2e tasks.spec.ts task-conflicts.spec.ts`: **8/8 passed**, covering desktop/mobile column placement, stacked layout, inline accordion details, Keep editing / Discard changes, task review, scoped failures, and stale-answer recovery. Synthetic collapsed and expanded screenshots were inspected in `.local/e2e-0ZhsaF`; no horizontal overflow.
- `pnpm test:e2e borrower-workspace.spec.ts staff-workspace.spec.ts intake.spec.ts`: **39 passed, 1 existing intentional skip, 0 failures or flakes** in `.local/e2e-d664Cl`. Application selection, setup completion/resume, limited summaries, account switches, staff flows, and portal navigation remain verified.
- Final review disabled the unsaved-change prompt's actions while an answer save is pending and clears the prompt after success, preventing an older save from replacing a newly selected task. The focused pending-save/task-switch regression passed **2/2 desktop/mobile cases** in `.local/e2e-SqrXaV`. Final affected package/root typechecks, Biome, `git diff --check`, and all 12 builds passed again.

No backend, migration, dependency, or hosted deployment change was needed for this layout follow-up.

## Save warning flicker — October 7, 2026

Done — reproduced and fixed the user's brief “This task has changed” warning during Save. Both dashboard adapters await task-list and application-summary refreshes before returning the successful mutation's detail to the editor. The refreshed list could therefore be one revision ahead of the still-saving editor, and the previous inequality check incorrectly presented the user's own write as a conflict.

The shared task component now checks for a newer list revision only after the pending mutation settles. A list older than a freshly loaded editor is also correctly treated as an older snapshot, not a conflict. Genuine newer edits and server revision conflicts still preserve entered answers and require explicit reload. No API or persistence changes were needed.

Validation:

- Added a controlled slow-summary browser regression and reproduced the original borrower warning before the fix in `.local/e2e-qAOtjJ`.
- `pnpm test:e2e task-conflicts.spec.ts tasks.spec.ts`: **14/14 passed** on desktop/mobile in `.local/e2e-upkrZJ`, including borrower answer saves, staff assignment saves, newer versions arriving through polling, explicit reload while the list remains older, real concurrent-answer rejection, and existing task workflows.
- `pnpm check`: Biome/browser boundaries, all workspace/root typechecks, and **208 unit tests** passed. `pnpm build`: **12/12 passed**, retaining the existing non-fatal Vite chunk-size advisories. `git diff --check` passed.
