# T10 — Bank application queue and staff workspace

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
- Staff creation sends the borrower a local continuation link and preserves staff origin/creator metadata.
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
3. Choose **Create application**, use a fictional `example.test` address, and prefill a business, amount, and purpose. Open its Overview to inspect incomplete setup and pending contact status.
4. Assign an officer and add/edit an internal note. Reload to verify persistence. Check the unavailable task/document/check sections.
5. Open the recipient's continuation message in Mailpit at `http://127.0.0.1:8025`, confirm sign-in, and finish the borrower setup. The staff prefill remains saved; completion still requires the applicant. Internal notes are absent from the borrower portal.

T11 participant management, T12 tasks, T13–T16 evidence/checks, and T19–T20 decisions/funding remain deferred. No hosted migration or deployment was performed.

### Local sign-in recovery — October 7, 2026

The reported `INTERNAL_ERROR` on port 3002 was reproduced while the frontend/API were alive but the Podman machine and database were stopped. Infrastructure was restarted in an independent process so it survives the launching command session, and the existing worker watcher was restarted after recovery. Live checks confirmed database/worker readiness, successful seeded officer sign-in, and a bank-scoped application queue; the temporary verification session was revoked. Existing records were preserved.

Both API transports now translate recognized structured connection failures (including wrapped/aggregated driver errors) to HTTP 503 `SERVICE_UNAVAILABLE` without logging or returning raw exception details. Unknown SQL/configuration/application errors remain 500. The sign-in screen keeps the entered email and offers a clear retryable outage message. Validation: `pnpm check` passed (lint, types, boundaries, 161 unit tests); the focused desktop/mobile sign-in outage-and-retry browser test passed 2/2 with no skips or failures (`.local/e2e-nC2ylx/summary.json`). The recovered development API remained ready after the isolated browser runner exited.
