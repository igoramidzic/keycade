# T09 — Borrower dashboard and portal after setup

V2 amendment — October 8, 2026, **not implemented**: [V2-02](../v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard), after V2-01, replaces the borrower application tab bar with one tasks-left/progress-and-upload-right dashboard. Its acceptance supersedes the tab-navigation criteria below while preserving authorized contextual signing, submission, closing, documents, people/activity and existing deep links. Business/application selection and funded summaries remain. Baseline Done evidence is not v2 acceptance.

Dependencies: T08. Read [product](../01-product.md) and [access rules](../03-domain-and-access.md).

## Outcome

A borrower who has completed initial setup enters a portal showing that application's remaining tasks. Authorized application selection keeps unfinished setups resumable and other applications independently accessible.

## T08 handoff

T08 provides React Router routes `/apply`, `/applications/:applicationId/setup`, and `/applications/:applicationId`, plus a minimal paginated selector at `/`. Expand the completed-application handoff in `apps/borrower/src/app.tsx`. The server's `nextDestination` remains authoritative; wait for a fresh destination response before redirecting so cached incomplete/completed values cannot loop. Setup and destination caches are scoped by bank, user, and application. Mutation preflight also checks the current session's bank and email before sending an answer.

Retain the synthetic distinction, explicit pending-draft claims, no-create generic resume, and existing desktop/mobile regression journeys. The selector does not yet group businesses or show the full product/status/update summaries; those remain this task's acceptance criteria. Do not replace the wizard with a task dashboard before server-confirmed completion.

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

Implemented and verified October 7, 2026.

- Business-grouped, paginated application cards show the pinned product, exact amount, lifecycle, update timestamp and permitted next action. Business IDs establish grouping; similarly named unlinked drafts remain independent. Counts describe loaded authorized records, never hidden applications.
- `/applications/:applicationId` is Overview; `/tasks`, `/documents`, `/people` and `/activity` retain explicit application context. Each unfinished applicant entry returns to the saved setup step. Closed applications have a terminal summary; scoped participants enter their permitted workspace without completing the applicant wizard.
- Both API transports implement `GET /api/v1/banks/:bankId/applications/:applicationId/portal` with the same participation/setup guard and OpenAPI contract. Selection responses add `businessId`, `productName`, `updatedAt` and `accessScope`; assigned summaries redact amount and purpose, including on the earlier read endpoint. `remainingTasks` is explicitly null until T12.
- Lists and portal summaries refresh on focus and every 30 seconds while visible. Query keys and authenticated read preflights use bank/email/application context. Fresh destination reads govern navigation; closed polling results remove active portal navigation. Setup completion badges use persisted setup status, including for invited participants.
- Existing intake save/recovery behavior remains. Default shadcn cards/buttons/badges and wrapping navigation support keyboard and mobile. All later-feature sections are honest unavailable states; there are no invented tasks, progress percentages, funded records or balances.
- Idempotent seeds add an unfinished Cedar application saved at the amount question (ID ending `000006`) and a withdrawn Cedar draft (`000007`). The borrower has four grants across two businesses. Existing edited records remain untouched. No database schema changes were needed.

Validation:

- `pnpm check`: Biome, browser/server boundaries, all workspace/root TypeScript checks and **129 unit tests** passed. Borrower/root typechecks and Biome also passed after the final polling and test changes.
- `pnpm build`: all **12 workspace builds/checks** passed. The existing Vite advisory about a borrower entry chunk over 500 kB remains; no build failed.
- `pnpm test:integration`: **127 tests across 15 files** passed against disposable real PostgreSQL databases. New checks cover paginated authorized summaries, isolation/guessed URLs, setup/closed guards, assigned redaction, participant versus staff access, revocation, empty lists and both HTTP/OpenAPI transports. Seed repeatability/preservation passed.
- Borrower/intake browser verification first found and corrected two test assumptions (wizard exit uses Continue later; closed assertions wait for navigation). The workspace rerun passed **16 desktop/mobile cases**. The final full `pnpm test:e2e` run passed **44**, with **2 intentional staff/mobile duplicates skipped**; its only failures were the new account-switch test’s clock installed after native interval scheduling. After fixing test clock setup and foregrounding each tab, `pnpm test:e2e borrower-workspace.spec.ts --grep 'polling after an account switch'` passed the final **2** desktop/mobile cases with unchanged assertions. All **46 active cases** now pass, with no flakes. Owned browser processes and disposable databases were cleaned up.
- Browser coverage includes multiple businesses/drafts, cache separation, keyboard activation, mobile overflow, setup completion, old setup links, direct URLs, refresh, scoped collaborators, closed drafts, loading/empty/error/retry states, live terminal transitions and same-bank account switching. Intake regressions retain demo/Mailpit access, storage loss, retries, revision conflicts and session recovery.
- Reviewed captured synthetic desktop portal and mobile dashboard screenshots: readable default styling, wrapping layout, no horizontal overflow. `pnpm db:seed` inserted missing fixtures into local development without overwriting existing records. `git diff --check` and **115 local documentation paths** passed.

No acceptance criteria remain unverified within T09’s scope. Later-feature empty states are intentional; no hosted deployment was performed.

## Try it locally

1. Run `pnpm initialize` to apply existing migrations and insert missing synthetic fixtures without overwriting edits, then `pnpm dev`. If already initialized/running, `pnpm db:seed` adds the new fixtures.
2. Open `http://127.0.0.1:3001` (or the configured borrower port), enter `borrower@example.test`, and choose **Sign in to demo**. The dashboard groups Cedar and Maple applications, including $10,000 and $5,000,000 completed setups, a Cedar draft, and a withdrawn draft.
3. Open a completed application and navigate Overview, Tasks, Documents, People and Activity. Refresh a section and check that the application stays selected. The later-feature sections explain what is unavailable.
4. Return to **Your applications**, choose **Continue setup** on the Cedar draft, and confirm it resumes at requested amount. Use **Continue later**, open another application, and come back; their data stays separate. Complete the questions and **Finish setup** to enter this draft’s portal.
5. Before finishing the draft, try `/applications/60000000-0000-4000-8000-000000000006/tasks?bank=bank-a`: it returns to setup. After completion, that URL stays in Tasks, and the old `/setup` link opens Overview. The withdrawn card always shows its closed summary.
6. Sign out and use `adviser@example.test`: only the permitted Cedar application appears, marked **Limited access**, without requested amount or purpose. The unshared ID ending `000003` is unavailable even when entered directly.

Automated checks: `pnpm check`, `pnpm build`, `pnpm test:integration`, and `pnpm test:e2e -- tests/e2e/borrower-workspace.spec.ts tests/e2e/intake.spec.ts`. The browser runner owns disposable PostgreSQL data and separate processes; it preserves your development database.

T10 remains the next task. Task interactions, uploads, collaboration, activity and funded-account details remain with T11–T14/T20–T21. No hosted deployment was performed.
