# T09 — Borrower dashboard and portal after setup

Dependencies: T08. Read [product](../01-product.md) and [access rules](../03-domain-and-access.md).

## Outcome

A borrower who has completed initial setup enters a portal showing that application's remaining tasks. Authorized application selection keeps unfinished setups resumable and other applications independently accessible.

## Scope

- Build business-grouped application cards/list with product, exact requested amount, status, last update, and permitted next actions.
- Resolve authenticated entry, application selection, refresh, and deep links using T07's persisted setup state. Unfinished applicant drafts open their saved wizard step; completed setups open the portal. When selection is necessary before setup, show a minimal selector with “Continue setup”/“Open application” actions.
- Add application detail/navigation for Overview, Tasks, Documents, People, and Activity. Show honest empty states until the owning features exist.
- Make remaining tasks and the next permitted action clear on portal entry; connect real requirement/task summaries when T12 lands. Initial setup completion must not imply those tasks or the application itself are complete.
- Implement API list/detail summaries derived from current access; paginate and preserve explicit application context in routes.
- Use query invalidation or bounded polling for persisted changes, and show pending/failed save states from intake.
- Reserve the funded-account section for T20 without displaying a fabricated balance or placeholder funded record as real data.

## Acceptance criteria

- A fixture borrower with two businesses and several applications can distinguish and navigate each correctly.
- Cards, counts, and details include only granted applications; a guessed URL is denied by the API.
- Editing one application never overwrites another application's cache or draft state.
- An unfinished setup cannot reach that application's applicant task workspace through a card, old link, direct URL, refresh, or direct API request. It does not block another application's completed portal. Staff access and limited invited-participant scope remain intact.
- A successful wizard finish enters the correct application's portal; subsequent authenticated visits go there without replaying setup. New later-stage tasks do not reopen the initial wizard.
- Empty, loading, no-access, and server-error states are useful on desktop and mobile.
- No task completion percentage is fabricated before T12 provides applicable requirements; show the known lifecycle/next action instead.

## Validation

Test list/detail authorization, setup guards, and cache keys, then run a multiple-application browser journey with both unfinished and completed setups. Check post-authentication routing, stale continuation links, direct URLs/API calls, refresh, and keyboard navigation. Verify a participant with limited fixture scope sees only its permitted summary and is not asked to complete the applicant's wizard. Confirm closed/denied drafts do not cause redirect loops.

Task interactions, document upload, people management, and activity populate in T11–T14/T21 rather than being implemented here.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
