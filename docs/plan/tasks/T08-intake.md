# T08 — Mock bank and required initial setup wizard

Dependencies: T07, including persisted setup state and completion guards. Read [main journeys](../01-product.md#main-journeys) and [setup state](../03-domain-and-access.md#initial-setup-state-and-completion).

## Outcome

A borrower starts from a fictional bank site, completes a dedicated one-question-at-a-time setup wizard, and enters the task portal only after setup is complete. Leaving partway through preserves progress for later resume. Local demo mode signs in immediately; the optional email-link path verifies the address.

## Backend handoff

T07 is complete. Use its [API contracts and error semantics](T07-application-service.md#api-handoff), including the server-provided next destination, explicit pending-draft claim, and revision returned after each save. Generate a fresh 256-bit hexadecimal key for a public start and UUID keys for authenticated creation/completion; preserve keys across retries. Generic resume must never call create.

## Scope

- Build a small mock bank page with apply and resume actions; carry a public bank slug/product hint to the separate borrower app.
- Implement email-first start and inbox guidance/verification return for the email-link path.
- Build a dedicated setup route with one simple question per screen: business name, requested amount, purpose, product selection when needed, and optional industry text/code. Provide plain-language prompts, Back/Continue, optional Skip/“I don't know,” and an accessible step indicator.
- Default local demo mode to immediate email entry using T06's demo session. Keep mailbox verification optional for the synthetic demo and required for the non-demo email-link path, as recorded in [the user's override](../06-decisions-and-sources.md#immediate-demo-sign-in-october-6-2026).
- Save answers and step progress through T07's revision-aware updates; show saving/saved/failed states, retain edits on failure, and advance only after the server acknowledges the save. Back restores answers and revalidates dependent steps after edits.
- Add “Continue later” and authenticated resume to the saved step of the same application, including fresh links or browser storage loss. Do not use local storage as the source of truth.
- End with a summary/correction step and explicit “Finish setup” action invoking T07's completion command. Only success opens a completion-to-portal route for T09 to expand; sign-in alone or partial answers cannot unlock the portal. Keep wizard progress separate from later task progress.
- Use generated shadcn forms/buttons/alerts and default styling with keyboard/mobile layouts.

## Acceptance criteria

- The apply button opens the correct borrower app and bank context without embedding secrets.
- Email is collected first and a draft appears for bank retrieval while setup remains incomplete.
- After authorized sign-in, each question screen asks for one answer. Required initial details can be finished without a password, EIN, SSN, documents, checks, or known NAICS code; optional industry can be explicitly skipped.
- Closing/reopening the browser, losing local storage, signing in on another device, or requesting a fresh link restores the same application's saved answers and current step without creating a new draft.
- Back/Continue preserve answers; the step indicator reflects acknowledged progress. “Continue later” distinguishes saved progress from any failed/unsaved edit.
- Direct portal navigation before completion returns to setup. Invalid/incomplete answers or failed completion keep the user in the wizard; a successful finish opens the portal once and later visits return there. Staff-prefilled drafts still require applicant confirmation.
- Invalid amounts, failed saves, expired links, and stale revisions have clear recoverable UI states; values are not silently discarded.
- Client-supplied bank/product hints are validated by the API and cannot bypass allowed products or tenant boundaries.
- The local demo journey requires no inbox visit; reopening the browser and entering the same email resumes authorized synthetic data without duplicating the draft.

## Validation

Run browser journeys from bank site through local demo sign-in and separately through Mailpit. Answer some questions, go back/edit, leave, clear browser storage, authenticate again, resume the saved step, skip industry, and finish setup. Verify early portal deep links return to setup, completion/save failures are recoverable, and later sign-in opens the portal. Check keyboard focus/order, field errors, progress announcements, mobile width, and network-failure recovery. Use a mocked industry fixture until T15 supplies the search adapter.

Defer the full dashboard, collaborators, and evidence collection to subsequent tasks.

## Implementation record

Implemented October 7, 2026.

- Mock bank apply/resume actions pass public bank/product context to the separate borrower app. Demo access defaults to immediate email entry; the Mailpit option creates a pending draft before verification and supports expired/fresh links.
- React Router routes isolate the setup wizard from the completion handoff. A minimal paginated selector routes each application using its current server destination, including pending claims, closed applications, and limited assigned access. It does not implement T09's dashboard.
- React Hook Form renders one answer per screen with Back/Continue, optional industry skip, acknowledged step progress, summary corrections, Continue later, and explicit Finish setup. Default shadcn Alert and Native Select were added through `npx shadcn@latest add alert native-select --cwd apps/borrower --yes`; one pnpm lockfile remains.
- TanStack Query keys include bank, email, and application. Fresh destination/setup reads prevent stale cached redirects. Failed saves/completion retain input; stale revisions show the latest saved answer for deliberate retry. An in-memory buffer preserves unsaved answers across same-tab reauthentication/product correction; only server-acknowledged answers survive closing a tab. No local/session storage is used for application state.
- Both HTTP transports expose `GET /api/v1/public/banks/:bankSlug/intake`. Bank/product hints cannot grant participation or cross tenant boundaries. Setup carries the selected product's actual version and limits, even when newer catalog versions exist. Retired-product recovery navigates to a replacement without bypassing answer/completion validation.

Validation:

- `pnpm check`: Biome, package boundaries, all workspace/root TypeScript checks, and **129 unit tests** passed.
- `pnpm build`: all 12 workspace builds/checks passed. Vite reports an advisory about the borrower entry chunk exceeding 500 kB; route splitting is a later optimization, not a failed build.
- `pnpm test:integration`: **123 tests across 15 files** passed using fresh real PostgreSQL databases. Coverage includes public catalog validation/HTTP parity, bank isolation, older product descriptors, and retired-product recovery through amount correction and completion.
- `pnpm test:e2e` uses the isolated runner with real runtime limits, private logs, owned-process cleanup, and disposable database teardown. Browser journeys: **28 passed, 2 intentional mobile duplicates skipped** across desktop/mobile. The seeded staff identity and staff-prefill cases execute on desktop; other journeys execute on both. Coverage includes bank navigation, keyboard focus/tab order, mobile overflow, demo/Mailpit starts, storage loss, a separate browser device, fresh/expired/replayed links, failed saves/completion, lost creation acknowledgment, stale revisions, staff prefill, direct portal guards, later sign-in, failed sign-out, same-tab reauthentication, and same-bank account switching in another tab.
- Final focused browser rerun after recovery hardening: **4 passed**, including product correction preserving an unsaved amount while the server stores only the requested navigation.
- Manual in-app browser review confirmed bank/unknown-product/unknown-bank states, readable default styling, heading focus, product correction, and Continue later. `git diff --check` and local documentation links passed.

The industry choices are intentionally a bounded synthetic fixture until T15. T09 owns business grouping, portal navigation, and remaining-task empty states; T10 owns bank queue/prefill screens. No hosted migration or deployment was performed.

Planning clarification — October 6, 2026: updated the wizard contract, T07 persistence/guards, T09 portal handoff, related tasks, decisions, and requirement map. Documentation validation passed: `git diff --check` and a local Markdown path/heading check (110 links across 36 files). Implementation acceptance tests were not run for this documentation-only change; the wizard was not started at that time.
