# T07 — Application creation and resumable drafts

Dependencies: T06. Read [product journey](../01-product.md) and [lifecycle](../03-domain-and-access.md).

## Outcome

One backend use case creates and updates applications from both borrower and staff entry points.

## Scope

- Implement restricted public email-start: validate public bank/product, create pending contact/draft, and queue a continuation link in one durable workflow.
- Implement staff creation on behalf of a borrower through the same creation service; record source, actor, bank, contact, and optional existing authorized business.
- On email verification, bind the selected intended draft/contact to the verified identity and appropriate participant role. Fresh generic resume lists existing grants and pending drafts addressed to that verified email within the selected bank; selecting one claims it idempotently without accepting unrelated invitations. Never merge businesses on name or supplied identifiers alone.
- Add get/list/draft-patch services with decimal-string amounts, configurable product limits, optional industry, autosave revisions, and stable pagination. Generic draft DTOs reject raw EIN/SSN fields; private collection comes through T15/T16.
- Use request idempotency records scoped to operation/actor or a secure public-start request context; handle same-key payload conflicts.

## Acceptance criteria

- Entering email creates a pending profile/draft before additional information; the response grants no access to existing records.
- Borrower and staff creation obey the same invariants and expose their source in audit/history.
- Concurrent retries return one logical application; an intentional new key creates another application even for the same business.
- $10k, $5m, and $7.5m are represented exactly where allowed by product configuration.
- Initial details can omit EIN, SSN, and NAICS. A saved step is restored after a new session, including when the original link expired or the browser state was lost. Several pending drafts for one email can be distinguished after verification; resume creates no duplicate application.
- Unauthorized edits and conflicting revisions fail without partial writes or lost updates.

## Validation

Test both entry points, public-start rate limiting, generic responses, transaction rollback, concurrent idempotency, duplicate-email behavior, money bounds, tenant isolation, and revision conflicts with real PostgreSQL.

Keep the creation service callable by a future authenticated bank integration; do not build a public partner API or SSO yet.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
