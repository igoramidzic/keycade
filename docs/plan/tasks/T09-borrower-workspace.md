# T09 — Borrower dashboard and application workspace

Dependencies: T08. Read [product](../01-product.md) and [access rules](../03-domain-and-access.md).

## Outcome

A borrower sees all applications they may access and a clear workspace for each one.

## Scope

- Build business-grouped application cards/list with product, exact requested amount, status, last update, and permitted next actions.
- Add application detail/navigation for Overview, Tasks, Documents, People, and Activity. Show honest empty states until the owning features exist.
- Implement API list/detail summaries derived from current access; paginate and preserve explicit application context in routes.
- Use query invalidation or bounded polling for persisted changes, and show pending/failed save states from intake.
- Reserve the funded-account section for T20 without displaying a fabricated balance or placeholder funded record as real data.

## Acceptance criteria

- A fixture borrower with two businesses and several applications can distinguish and navigate each correctly.
- Cards, counts, and details include only granted applications; a guessed URL is denied by the API.
- Editing one application never overwrites another application's cache or draft state.
- Empty, loading, no-access, and server-error states are useful on desktop and mobile.
- No task completion percentage is fabricated before T12 provides applicable requirements; show the known lifecycle/next action instead.

## Validation

Test list/detail authorization and cache keys, then run a multiple-application browser journey. Check keyboard navigation and deep-link/refresh behavior. Verify a participant with limited fixture scope sees only its permitted summary.

Task interactions, document upload, people management, and activity populate in T11–T14/T21 rather than being implemented here.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
