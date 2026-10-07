# T08 — Mock bank and required initial setup wizard

Dependencies: T07, including persisted setup state and completion guards. Read [main journeys](../01-product.md#main-journeys) and [setup state](../03-domain-and-access.md#initial-setup-state-and-completion).

## Outcome

A borrower starts from a fictional bank site, completes a dedicated one-question-at-a-time setup wizard, and enters the task portal only after setup is complete. Leaving partway through preserves progress for later resume. Local demo mode signs in immediately; the optional email-link path verifies the address.

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

Not started. Record date, commands/results, and deviations when implemented.

Planning clarification — October 6, 2026: updated the wizard contract, T07 persistence/guards, T09 portal handoff, related tasks, decisions, and requirement map. Documentation validation passed: `git diff --check` and a local Markdown path/heading check (110 links across 36 files). Implementation acceptance tests were not run for this documentation-only change; the wizard remains not started.
