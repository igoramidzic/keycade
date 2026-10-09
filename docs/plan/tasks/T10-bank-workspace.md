# T10 — Bank application queue and staff workspace

V2 amendment — October 8, 2026, **implemented; acceptance recorded in the linked v2 tasks**: [V2-05](../v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns), after V2-01/V2-04, owns the richer business/loan/financial overview and stage/evidence drilldowns. Keep the queue, lender tabs and staff-created handoff. V2-01 updates compatible optional prefills; V2-05 adds source-backed financial, group-count and navigation acceptance. The original baseline remains completed.

Dependencies: T07. Read [staff journey](../01-product.md) and [access matrix](../03-domain-and-access.md#access-matrix).

## Outcome

Bank staff can find drafts, create an application on a client's behalf, and inspect a structured application record.

## Scope

- Add a staff-only bank console with server-paginated application queue, search, stage/product/assignee filters, and stable sorting.
- Build detail views for overview, participants, tasks, documents, checks, and internal notes, with clear unavailable/empty sections before dependent tasks exist.
- Add staff-created application form using T07's service, staff assignment, and internal notes with audit records.
- Show pending/unverified contacts and persisted setup progress accurately; staff can see and prefill drafts before borrower setup completion or submission. Prefill does not mark setup complete.
- Keep UI actions aligned with implemented commands; review/approval/funding controls arrive in T19/T20.

## Acceptance criteria

- Authorized staff see their bank's drafts and submitted records with expected filtering and pagination.
- A borrower cannot access staff endpoints; Bank A staff cannot access Bank B records, notes, or counts.
- Staff creation accepts borrower email with optional business name, amount and purpose; supplied answers, draft, audit, idempotency and one simulated continuation intent commit together. Invalid prefills create no draft or delivery intent. The borrower receives a targeted continuation through local Mailpit or the hosted demo inbox; staff origin/creator metadata is preserved. Repeated identical requests return the same draft, including recovery after a lost response.
- A staff-created draft exposes prefilled answers and incomplete setup through T07's authorized resume response; staff create/prefill calls cannot complete setup. Staff can inspect setup progress throughout. T08 covers the borrower-facing confirmation journey.
- Staff assignment and note changes persist and are audited; notes never appear in borrower DTOs.
- Empty results, unavailable API, and no staff membership produce clear UI states.

## Validation

Test server-side filters/pagination and cross-bank isolation. Demonstrate bank-created and borrower-created drafts appearing in the same queue. Verify safe staff response schemas and internal-note exclusion through direct API tests.

The demo policy grants active officers bank-wide access. Staff-team restrictions and a complete bank administration UI remain deferred.

## Implementation record

Done — implemented and validated October 7, 2026.

The staff console replaces its foundation shell with an authenticated application queue and application workspace. Server-side search covers business name, contact email, and application ID. Stage, pinned product version, and assignee filters apply to both rows and counts. Page/limit pagination and allowlisted sorts use an application UUID tie-break; each page and its count share a consistent database snapshot. Assignment remains a workflow field, not an access boundary.

Overview shows origin/creator, exact requested amount, contact verification state, and saved setup progress. Participants shows current and revoked grants. Tasks, Documents, and Checks explicitly remain unavailable until their owning tasks. Staff can create a draft, prefill initial answers, assign an active officer, and add/edit internal notes. These actions never finish the applicant's setup or expose approval/funding controls.

Migration `0006_solid_iceman.sql` adds bank/application-scoped `staff_notes`, bank-scoped author/editor foreign keys, and queue/note indexes. Assignment and note edits lock the application, validate its revision, advance application/setup revisions together, and append audit metadata without note bodies. Both Fastify and the native Worker expose validated staff contracts and recheck current bank membership. Borrower DTOs remain explicit allowlists with no internal notes.

Staff creation reuses T07's creation transaction and idempotency key. A configured server-side borrower origin queues one targeted continuation request in the same transaction as the new draft. The existing worker delivers it to local Mailpit. Duplicate creation retries do not enqueue another message. Hosted staff creation explicitly reports unavailable delivery before writing a draft; no hosted delivery or deployment was added.

Validation on October 7, 2026:

- `pnpm db:migrate` — committed local migration and queue schema applied without resetting records. Fresh PostgreSQL databases and the pre-T10 upgrade test verify note constraints and preservation of existing application/setup data.
- `pnpm check` — Biome, browser/server dependency boundaries, all workspace/root TypeScript checks, and 129 unit tests passed.
- `pnpm test:integration` — 145 tests in 17 files passed against PostgreSQL, including both HTTP transports, submitted/draft filtering, literal search, pagination, tenant counts/options, live membership revocation, assignment, note concurrency/rollback, contact status, continuation idempotency, and borrower DTO exclusion.
- `pnpm build` — all 12 workspace tasks passed. The existing borrower bundle retains its nonblocking size warning; the staff bundle builds successfully.
- `pnpm test:e2e tests/e2e/staff-workspace.spec.ts` — 12 desktop/mobile checks passed with no skips or retries. This covers local Mailpit continuation through explicit applicant completion, mixed-origin queue filtering/pagination, assignment/note persistence, two-tab conflict recovery, inaccessible records, unavailable sections, loading/failure/retry, and denied staff access. Safe queue/detail screenshots were visually inspected.
- `pnpm test:e2e` — complete regression: 58 passed, 2 existing mobile-only duplicate fixture skips, no failures or flaky cases. All 12 new staff cases run on both viewports. Local evidence: `.local/e2e-LI1zng/summary.json` (staff) and `.local/e2e-AOWrmt/summary.json` (full suite); these private test artifacts remain ignored.

The local Podman virtual machine became unavailable during one integration attempt. Restarting the existing machine/containers and running infrastructure startup and validation in the same command session restored connectivity; the complete 145-test rerun passed. No volume reset was used. Browser runners use disposable databases and stop only their owned application processes.

### Try it locally

1. Run `pnpm initialize` (or `pnpm db:migrate` for an initialized checkout), then `pnpm dev`.
2. Open the bank console at `http://127.0.0.1:3002` and sign in as `officer-a@example.test`. Search and filter the queue; choose a small page size to exercise pagination.
3. Choose **Create application**, enter a fictional `example.test` address, and optionally prefill business name, amount and purpose. Select **Create and invite borrower**. Its Overview shows the saved draft, incomplete setup and pending contact.
4. Assign an officer and add/edit an internal note. Reload to verify persistence. Check the unavailable task/document/check sections.
5. Open the recipient's continuation message in Mailpit at `http://127.0.0.1:8025`, confirm sign-in, and finish the borrower setup. The staff prefill remains saved; completion still requires the applicant. Internal notes are absent from the borrower portal.

T11 participant management, T12 tasks, T13–T16 evidence/checks, and T19–T20 decisions/funding remain deferred. No hosted migration or deployment was performed.

### Local sign-in recovery — October 7, 2026

The reported `INTERNAL_ERROR` on port 3002 was reproduced while the frontend/API were alive but the Podman machine and database were stopped. Infrastructure was restarted in an independent process so it survives the launching command session, and the existing worker watcher was restarted after recovery. Live checks confirmed database/worker readiness, successful seeded officer sign-in, and a bank-scoped application queue; the temporary verification session was revoked. Existing records were preserved.

Both API transports now translate recognized structured connection failures (including wrapped/aggregated driver errors) to HTTP 503 `SERVICE_UNAVAILABLE` without logging or returning raw exception details. Unknown SQL/configuration/application errors remain 500. The sign-in screen keeps the entered email and offers a clear retryable outage message. Validation: `pnpm check` passed (lint, types, boundaries, 161 unit tests); the focused desktop/mobile sign-in outage-and-retry browser test passed 2/2 with no skips or failures (`.local/e2e-nC2ylx/summary.json`). The recovered development API remained ready after the isolated browser runner exited.

### Officer-started application handoff — October 7, 2026

Done — implemented and validated locally October 7, 2026.

The user's requested bank-officer → borrower journey already had a staff form and targeted continuation. Investigation found that the form created/queued the draft first, then saved optional details through a second request. A rejected amount or interrupted save could therefore leave an invited empty draft. The shared creation contract now accepts optional `answers` (business name, requested amount and purpose), validates configured product limits before insertion, and commits answers with the draft and its existing audit/idempotency/continuation transaction. No database migration or task-dependency change is needed. Staff-only initial answers cannot grant borrower permissions or complete setup.

The form now sends one creation command, labelled **Create and invite borrower**, and describes simulated delivery in both local and hosted environments. Email alone is sufficient; the other fields may be supplied independently. An ambiguous network/server response locks the attempted details and offers **Retry creation and invitation** with the original payload/key. A definitive validation error retains editable input and allows correction. The success screen confirms saved details and queued delivery without claiming that delivery has completed.

Focused coverage includes atomic full/partial/email-only creation; exact $10,000, $5,000,000 and $7,500,000 amounts; invalid zero/below/above-limit rollback; conflicting/replayed/concurrent creation; staff membership and bank isolation; both HTTP transports; and desktop/mobile officer creation through the emailed borrower's required setup. Browser regression also simulates a lost response after commit and verifies recovery of one draft and one invitation. Ongoing repayment servicing, contactless drafts and a dedicated original-applicant resend action remain outside this change. No hosted deployment is performed by this follow-up.

Validation, using the repository's pinned Node 24 runtime:

- `pnpm check` — Biome, browser package boundaries, all workspace/root TypeScript checks and 298 unit tests passed.
- `pnpm test:integration` — all 364 real PostgreSQL tests in 39 files passed, including the new staff/domain and Fastify/native Worker transport checks.
- `pnpm build` — all 12 workspace builds passed. Existing borrower/staff bundle-size warnings remain nonblocking.
- `pnpm test:e2e tests/e2e/staff-workspace.spec.ts` — 16 desktop/mobile cases passed with zero failures, skips or flaky cases. An initial run exposed outdated test scoping: the D05 sidebar duplicated business text and document articles, and default-bank URLs omit the optional bank query. Correcting assertions to use the actual application/review regions produced the clean rerun. Private evidence: `.local/e2e-QCjWoS/summary.json`; synthetic desktop/mobile staff screenshots were captured, and the desktop overview was visually inspected. Owned browser processes and the disposable database were cleaned up.
- Final Biome, root TypeScript and `git diff --check` passed after test-assertion corrections. No persistent records were reset, no schema migration was needed and no external email was sent.

## V2 hosted deployment follow-up — October 8, 2026

The officer-created handoff and V2-05 overview are included in the five-Worker release at `75b1f96`. [V2-08 hosted acceptance](../v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) verifies officer-prefilled unfinished setup, lender document review, financial history and scoped access denials. The earlier local record remains the evidence for the full queue/handoff matrix. All behavior remains simulated.

### Prefilled answers modal — October 8, 2026

Done — implemented and validated locally October 8, 2026.

The requested **Edit prefilled answers** action opens a native modal dialog above the overview. It uses the existing design-system modal styling, an accessible title/description, a viewport-bounded scrolling form, background scroll locking and focus return to the triggering button. Escape and both Close controls dismiss it; dismissal stays disabled during a save. Existing answer validation, conflict recovery, saved feedback and borrower-confirmation requirements remain intact. No task dependencies change.

Acceptance: verify modal opening on desktop/mobile, keyboard focus and Escape dismissal, both Close controls, saved-answer persistence after reopening, and the existing officer-to-borrower confirmation journey.

Validation: bank-console `tsc --noEmit` and Vite production build pass; targeted Biome checks pass. The existing nonblocking bundle-size warning remains. The isolated `staff-workspace.spec.ts --grep 'staff creates and updates a prefilled draft'` journey passes on desktop and mobile (2 passed, no failures/skips/flakes), including actual modal state, initial focus, Escape/Close dismissal and focus return, saved answers after reopening, and the emailed borrower completing setup. Evidence: `.local/e2e-nSM3Wc/summary.json`. Checks used the repository's pinned Node 24 runtime directly; the browser runner required sandbox escalation to reach local PostgreSQL and launch its owned processes. No hosted deployment was performed.

### Overview task list — October 8, 2026

Done — implemented and validated locally October 8, 2026. At the user's request, Overview embeds the same interactive task list as the Tasks tab at the top of its main column, above Application stages and Uploaded evidence, beside the assignment, borrower and activity panels. Officers can open, review and add tasks without leaving Overview. The Tasks tab, stage summaries and all task permissions are unchanged; no dependencies change.

Validation (shared with the other October 8 UI follow-ups in this change):

- `pnpm lint` (Biome and browser/server boundaries), root `tsc --noEmit` including `tests/`, and the shared UI, bank-console, borrower and bank-site typechecks pass. `pnpm test`: **425 unit tests** pass. All three web Vite builds pass (existing large-chunk warnings remain).
- `pnpm test:e2e` with `participants`, `collaborator-upload`, `staff-workspace`, `borrower-workspace`, `intake`, `demo-inbox` and `lender-overview-v2` (`.local/e2e-utpAIY`): **74 desktop/mobile cases — 65 passed, 8 skipped, 1 failed, 0 flaky**. The skips are the eight `demo-inbox` cases, which run only when `DEMO_INBOX_ENABLED=true`. The failure was the mobile *queue loading and service failure* case: by then the combined run had created 55 applications, pushing the seeded Synthetic Cedar Workshop off the first queue page. Rerun alone, it passed on desktop and mobile (2/2, `.local/e2e-ouo2wc`).
- Browser inspection against the local stack at 1280px and 375px (no horizontal overflow). All four `lender-overview-v2` cases and the staff workspace journeys pass with the task list on Overview; the desktop overview layout was checked. No hosted deployment was performed.
