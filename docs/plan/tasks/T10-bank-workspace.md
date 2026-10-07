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

Not started. Record date, commands/results, and deviations when implemented.
