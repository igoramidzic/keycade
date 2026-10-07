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

Not started. Record date, commands/results, and deviations when implemented.
