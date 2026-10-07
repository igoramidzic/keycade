# T08 — Mock bank and short application flow

Dependencies: T07. Read [main journeys](../01-product.md#main-journeys).

## Outcome

A borrower can begin from a fictional bank site, verify email, supply a few details, and continue later.

## Scope

- Build a small mock bank page with apply and resume actions; carry a public bank slug/product hint to the separate borrower app.
- Implement email-first start, inbox guidance/verification return, and short steps for business name, amount, purpose/product, and optional industry text/code.
- Save meaningful steps using revision-aware updates; show saving/saved/failed states and preserve edits on failure.
- Add continue-later/resume navigation and a simple completion-to-workspace route for T09 to expand.
- Use generated shadcn forms/buttons/alerts and default styling with keyboard/mobile layouts.

## Acceptance criteria

- The apply button opens the correct borrower app and bank context without embedding secrets.
- Email is collected first and a draft appears for bank retrieval before the long form is completed.
- After verification, the user can finish initial details without a password, EIN, SSN, or known NAICS code.
- Closing/reopening the browser and requesting a fresh link restores saved data.
- Invalid amounts, failed saves, expired links, and stale revisions have clear recoverable UI states; values are not silently discarded.
- Client-supplied bank/product hints are validated by the API and cannot bypass allowed products or tenant boundaries.

## Validation

Run a browser journey from bank site through Mailpit to saved details and resume. Check keyboard order, field errors, mobile width, and network-failure recovery. Use a mocked industry fixture until T15 supplies the search adapter.

Defer the full dashboard, collaborators, and evidence collection to subsequent tasks.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
