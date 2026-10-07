# T20 — Closing conditions and recorded simulated funding

Dependencies: T17, T19. Read [product boundaries](../01-product.md#first-release-boundaries).

## Outcome

Approved applications progress through signing/closing and create one clearly identified funded-account summary.

## Scope

- Create versioned closing conditions and signature tasks from approved terms; transition to `closing` explicitly.
- Add staff closing checklist and borrower closing actions using existing task/signature services.
- Add funding record and loan-account tables, exact funded amount, date, reference, approved snapshot link, and simulated provenance.
- Implement guarded, idempotent staff-recorded funding and application-to-account linkage in one transaction.
- Populate borrower/staff funded-account summaries without constructing repayment balances or schedules.

## Acceptance criteria

- Approval alone creates no funded account. Funding is available only in closing with all applicable gates current and satisfied.
- Incomplete/expired/voided signatures and unresolved mandatory conditions block funding.
- Repeated and concurrent funding requests create one funding record/account and one logical transition/event.
- Account summaries identify business/product, approved amount, recorded funded amount/date/reference, and “Simulated.”
- Demo funding amount rules are explicit in product configuration; no accidental assumption that a credit-facility limit is an outstanding balance.
- A failed transaction leaves neither a partially funded application nor an orphan account. No operation calls a payment rail.

## Validation

Run approval → closing conditions → multi-signer completion → staff funding → borrower account summary. Test unmet conditions, duplicate/concurrent requests, amount validation, transaction rollback, and cross-bank access.

The first release supports a single recorded funding event per application. Partial/distributed disbursements, subsequent draws, available credit, repayments, accruals, and servicing accounting require a later plan.

## Implementation record

### October 7, 2026

Migration `0019_curious_colleen_wing.sql` adds versioned product closing policies, pinned application closing packages, conditions, immutable funding records, linked loan accounts and actor-bound command receipts. Existing synthetic business-credit product versions receive the same policy non-destructively; newly created demo versions initialize it when closing starts. The configured amount policy is exactly the approved USD amount, with one funding event per application.

Staff explicitly start closing from a current approval. The package preserves approved terms and creates an acknowledgement task and a mandatory signature condition. The signature condition cannot be answered, reviewed or waived around the signing service; every intended signer, participant grant, clean source version and signature artifact must still be current. Readiness explains each unsatisfied condition once.

Funding requires a deliberate human confirmation, the current application revision, a valid date and synthetic reference, and all current readiness gates. The transaction writes the funding record, account, lifecycle, audit, notifications and idempotency receipt together. Concurrent commands serialize on the application and retain exactly one account. Borrower and staff account summaries group by business and show approved versus recorded amounts with a visible Simulated label. Restricted participants cannot read approved terms or accounts.

Validation: 10 real-PostgreSQL closing tests cover incomplete/expired/voided/stale signatures, mandatory conditions, amount/date policy, concurrent/repeated funding, rollback, bank boundaries and current participant scope. Two HTTP tests exercise both runtimes; migration upgrade coverage verifies existing product policies without resetting data. Full checkpoint checks pass: 272 unit tests, 347 PostgreSQL tests across 39 suites, all workspace types and 12 builds.

The desktop and mobile closing journeys both pass (`.local/e2e-vjG36g/summary.json`, 2/2): staff approve an exact amount, explicitly start closing, upload a task-attached synthetic agreement, obtain signatures from the applicant and an invited scoped adviser, review the ordinary closing condition, and deliberately record simulated funding. The journeys verify that approval and a premature funding attempt create no account, one remaining signer blocks funding, replaying the funding command returns the same account, and scoped advisers cannot read approved terms or account summaries. Borrower and staff dashboards show one account grouped under its business; funded applications retain their read-only closing and evidence views. Desktop/mobile prerequisite and funded-summary screenshots were inspected with no horizontal overflow or obscured controls.

Borrower workspace regression also passes (`.local/e2e-vkqQST/summary.json`, 18/18), including account switching and loading states. The funded-account section waits for a healthy application-list snapshot to avoid duplicate loading or session-error surfaces. Biome checks pass for all 17 changed UI/browser-test files, and `git diff --check` is clean. Browser setup requests are paced within the unchanged API limits, with inactive pages parked to avoid background polling bursts.
