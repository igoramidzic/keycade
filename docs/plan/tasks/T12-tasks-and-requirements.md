# T12 — Task workflows and versioned product requirements

V2 amendment — October 8, 2026, **implemented; acceptance recorded in the linked v2 tasks**: [V2-02](../v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) updates borrower layout without top tabs; [V2-05](../v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) distinguishes lender actions, check results and evidence groups. Retain preloaded task details, unsaved-edit protection, current review rules and restricted scope. New acceptance separates document counts from reviewed requirements and derives timeline stages from the existing lifecycle. No new task is created solely to display an uploaded tax return.

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
- Assignees complete their tasks (stored as `submitted`); staff mark them reviewed or return them; waiver requires a reason. Uploading or editing an answer alone cannot imply approval. See the [October 9 follow-up](#client-completion-without-a-review-step--october-9-2026).
- Restricted participants see only permitted tasks/evidence/counts; owner-private fields remain private. Removing an assignee leaves unfinished tasks unassigned immediately, including after that person is reinvited; historical authorship and completed work remain intact.
- Concurrent submissions/reviews reject stale revisions. Applicable completed/waived tasks drive progress accurately.
- The October 7 reference layout shows tasks immediately on application entry, with a wider task column on the left and application details on the right at desktop sizes. Mobile stacks the regions without horizontal overflow. Task detail expands beneath its row; switching or collapsing a task protects unsaved entries.

- Task details, answers, history and permitted task documents load with the workspace. Opening or switching a task uses the loaded snapshot without a per-task request or loading flash; explicit reload and mutation refresh still preserve revision checks and unsaved edits.
- Dashboard hierarchy uses a muted page surface, white primary panels, spacing and restrained selected states instead of repeated nested card outlines and horizontal rules.

- Lenders can select unfinished tasks while inviting a participant; acceptance assigns all selected tasks transactionally. Revision changes reject stale intent without partial participation or assignment. Existing visibility-only grants do not silently become assignments.

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
3. In a separate borrower session, sign in as `borrower@example.test`, open the same application's **Tasks**, and open the request. **Save answer** retains a draft; **Complete task** saves and completes it, and it shows as Completed.
4. In the bank session, reload/open the task, enter a review reason, and **Return for changes**. Revise and complete it again as the borrower, then **Mark reviewed** as staff. Inspect **Task history** and the progress counts.
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

## Upfront task details and quieter dashboard — October 7, 2026

The user requested immediate task expansion and fewer competing horizontal/card lines. The task-list contract now returns full authorized details, including answers, reviews and assignments. The service filters tasks before querying related history and batches those reads per table. Both dashboards load permitted document metadata alongside tasks; expanding a row selects an in-memory snapshot and makes no detail or document request. Polling can flag newer revisions without overwriting an edited answer. Explicit reload refreshes the complete snapshot, and permission failures still remove unavailable content.

Borrower and staff shells use a muted page background with white content panels. Account, navigation, task-row and nested-detail separator lines are removed. Expanded tasks have a subtle background; the borrower document shortcut is an unboxed sidebar section. Default shadcn inputs, buttons, focus rings and semantic status labels remain. No schema change is needed for these UI improvements.

Validation:

- `pnpm test:e2e tasks.spec.ts task-conflicts.spec.ts borrower-workspace.spec.ts`: all **36 selected desktop/mobile cases verified** across `.local/e2e-g5LSnt` (30 initial passes), `.local/e2e-Ocueoh` (four eager-loading cases), and `.local/e2e-ymB5xS` (two layout cases). Test assertions were corrected to distinguish “Uploading” from a loading status and to avoid assuming a random task order. Browser request interception proves no detail request or additional document request when opening/switching tasks.
- Final task-mutation/document-cache and save-conflict checks: **8/8 passed** in `.local/e2e-aVsuLe`. Successful task changes immediately refresh document permissions; unsaved edits and genuine conflicts remain protected.
- Both API transports return the same authorized full detail in the task list and detail endpoint. The combined PostgreSQL suite passed **228 tests in 27 files**, including private-history exclusion and cross-bank/setup guards.
- Desktop/mobile collapsed dashboard screenshots were inspected in `.local/e2e-ymB5xS`; hierarchy is clearer and neither viewport overflows.
- Additive document/enrichment migrations applied to the existing local database. The development API reports database and worker ready after restarting its file watcher. Existing data was preserved.

Final combined checkpoint: `pnpm check` passed Biome, browser boundaries, all workspace/root typechecks, and **256 unit tests in 18 files**. `pnpm build` passed all **12 workspace builds** with the existing non-fatal bundle-size advisories. `git diff --check` passed.

### Task selection on lender invitations — October 8, 2026

Done — verified locally; see [T11 follow-up](T11-participants.md#lender-only-invitations-and-task-assignments--october-8-2026). Lender-selected tasks become editable assignments on verified acceptance, with safe replay, stale-selection checks and current bank/application/privacy boundaries. Existing Tasks reassignment remains available for accepted participants. Validation is recorded with T11; no dependency changes or hosted deployment.

## Client completion without a review step — October 9, 2026

At the user's request, completing a task completes it for the client; lender review happens only on the lender side.

- **Complete task** replaces “Submit for review” for answer and secure-input tasks. It saves an edited answer first, then completes the task. The client sees **Completed** with a solid green check, and the task counts toward their progress and the submission gate right away.
- The persisted `submitted` state now means “completed by the assignee, not yet lender-reviewed”. Staff see **Needs your review** (blue) and can **Mark reviewed** (the existing `completed` review decision) or **Return for changes**, which reopens the task for the client.
- `taskDone` counts `submitted` with evidence as complete for progress. The submission gate accepts it. The same work appears to staff as an `awaiting_lender_review` blocker at the approval gate, so lender review is still required before approval. Simulated checks still require reviewed document evidence, and closing still requires reviewed closing tasks. Client readiness views never list review-pending items.
- The client progress header counts the visible, non-cancelled tasks it lists (optional ones included) and names how many required tasks are left, so the bar always matches the checkmarks. Borrower task actions now also refresh Task readiness.
- No schema migration: existing `submitted` rows take on the new meaning.

Done locally — October 9, 2026. Validation:

- `pnpm lint` (Biome and package boundaries), root `tsc --noEmit` including `tests/`, the shared UI, domain, bank-console, borrower and bank-site typechecks, and **426 unit tests** pass. `pnpm test:integration` passes **485 PostgreSQL cases in 50 files**, including a new case: borrower-completed submission tasks count toward progress and allow the borrower’s submission, are hidden from the client readiness view, and appear to staff as `awaiting_lender_review` approval blockers.
- Full `pnpm test:e2e` sweep (`.local/e2e-58n1Ql`): 228 desktop/mobile cases — **202 passed, 16 skipped** (eight opt-in `demo-inbox` and eight hosted-only cases), **10 failed**. Five `tasks.spec` failures came from selectors that assumed one open task while another was animating closed, a fake-clock case, and the former `<details>` group role; the specs were scoped and the closing content was made inert and `aria-hidden`. One `activity-operations` assertion matched the demo kit’s empty copy-status regions and is now scoped. Four failures were cross-spec data accumulation: an owner added by `borrower-dashboard-safety` in `checks.spec`, and the seeded application leaving queue page one in `staff-workspace.spec`.
- Reruns on the final code with fresh databases all pass. Task, checks, activity, closing, review, document-processing, participants and task-conflict specs: 44 passed; the two flaky desktop cases (`checks`, `closing`) then passed 4/4 on their own. Borrower dashboards, collaborator upload, integrated v2, signatures and lender overview: **30/30**. `staff-workspace.spec`: **16/16**, including the queue case.
- Headless Chromium against the local stack measured a task card growing over about 200 ms and collapsing to zero before its body is removed. Overview stage disclosures open with rotated chevrons.

No schema migration or hosted deployment was performed.
