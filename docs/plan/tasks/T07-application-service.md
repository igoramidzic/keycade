# T07 — Application creation and resumable setup state

Dependencies: T06. Read [product journey](../01-product.md) and [lifecycle](../03-domain-and-access.md).

## Outcome

One backend use case creates and updates applications from both borrower and staff entry points, persists initial setup progress, and enforces completion before applicant portal workflows.

## Scope

- Implement restricted public email-start: validate public bank/product, create pending contact/draft, and queue a continuation link in one durable workflow.
- Implement staff creation on behalf of a borrower through the same creation service; record source, actor, bank, contact, and optional existing authorized business.
- On email verification, bind the selected intended draft/contact to the verified identity and appropriate participant role. Fresh generic resume lists existing grants and pending drafts addressed to that verified email within the selected bank; selecting one claims it idempotently without accepting unrelated invitations. Never merge businesses on name or supplied identifiers alone.
- Honor the user's [local demo sign-in override](../06-decisions-and-sources.md#immediate-demo-sign-in-october-6-2026): allow a T06 demo actor to start/resume only synthetic drafts in its selected demo bank, without requiring email delivery. Record demo provenance; do not stamp mailbox verification or weaken the non-demo verification/claim path.
- Add get/list/draft-patch services with decimal-string amounts, configurable product limits, optional industry, autosave revisions, and stable pagination. Generic draft DTOs reject raw EIN/SSN fields; private collection comes through T15/T16.
- Add a committed migration for per-application setup state: step-definition version, current step, completed/skipped step keys, optimistic revision, and completion actor/time. Save canonical answers and step progress in one transaction and return a safe authorized resume summary.
- Add an explicit, revision-checked, idempotent finish-setup command for the applicant administrator. Validate required initial answers and atomically record completion, audit/job intent, and the `draft` → `collecting_information` transition. Staff can prefill answers but cannot bypass applicant confirmation.
- Provide shared backend guards for applicant portal operations and a safe next-destination result. Incomplete setups allow minimal selection summaries and setup access; direct portal requests cannot bypass the gate. Preserve staff draft access and scoped collaborator authorization.
- Use request idempotency records scoped to operation/actor or a secure public-start request context; handle same-key payload conflicts.

## Acceptance criteria

- Entering email creates a pending profile/draft before additional information; the response grants no access to existing records.
- Borrower and staff creation obey the same invariants and expose their source in audit/history.
- Concurrent retries return one logical application; an intentional new key creates another application even for the same business.
- $10k, $5m, and $7.5m are represented exactly where allowed by product configuration.
- Initial details can omit EIN, SSN, and NAICS. A saved step is restored after a new session, including when the original link expired or the browser state was lost. Several pending drafts for one email can be distinguished after verification; resume creates no duplicate application.
- Unauthorized edits and conflicting revisions fail without partial writes or lost updates.
- Answers and current/completed/skipped steps survive session/device changes. A failed save changes neither the stored answers nor progress; a dependent answer change invalidates affected step validation.
- Missing required answers, stale revisions, unauthorized actors, client-supplied completion flags, and direct applicant portal calls cannot bypass setup. Repeating a successful completion returns one completion and lifecycle transition without duplicate effects.
- Creation and staff prefill leave setup incomplete. Only explicit applicant completion unlocks the portal, including for a permitted local synthetic demo actor. Completing application A does not complete application B or grant anyone access.
- Setup completion does not submit, approve, fund, or satisfy later evidence/check requirements.
- The local demo can create/resume synthetic drafts after immediate email entry; demo actors cannot claim drafts in another bank or non-synthetic data.

## Validation

Test both entry points, public-start rate limiting, generic responses, transaction rollback, concurrent idempotency, duplicate-email behavior, money bounds, tenant isolation, and revision conflicts with real PostgreSQL. Cover answer/progress atomicity, optional skips, resume without browser state, staff-prefilled drafts, completion retries/races, per-application isolation, and setup guards through both HTTP transports. Exercise T06's allowed local demo actor as well as the email-link actor.

Keep the creation service callable by a future authenticated bank integration; do not build a public partner API or SSO yet.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
