# Requirement coverage

T01–T05 and D01–D02 are implemented and verified in [the local-foundation record](local-foundation-validation.md). T06 adds [locally testable passwordless access](identity-validation.md); rows covering later tasks remain planned. Use this map to check scope when implementing or revising the plan. Task IDs resolve through the [backlog](README.md#backlog).

| User requirement | Planned coverage | Key proof |
| --- | --- | --- |
| Brand-new Keycade project; plan first | Root README, AGENTS.md, this plan | Planning baseline preserved; first local milestone subsequently authorized. |
| Cloudflare deployment on default URLs | D02, T13 | Five Workers created; Hyperdrive/runtime login and Queue provisioned; all native builds and hosted readiness passed. R2 waits for T13. |
| Connect the repository directly to Cloudflare and deploy on pushes to `main` | D02 | Five native builds passed on `main` from repository root `/`, watching all paths. Hosted UI/API/Neon readiness passed. GitHub retains Neon migrations and runtime-login setup. |
| Neon PostgreSQL only; Cloudflare R2 for documents | D01, T13, decisions | Existing Neon project linked; verified TLS connection; local Podman settings preserved. |
| GitHub jobs own changes pushed to Neon; pause separate validation for faster demo deployment | D01 | Main-only Actions migration job with approved encrypted environment credential; hosted apply (2 migrations) and repeat no-op passed. Test/build validation and PR trigger commented out; migration-only job completed in 18 seconds. |
| Local PostgreSQL 18, with initial 17 data explicitly disposable | D01, T02 | Version-appropriate named-volume mount, ownership checks and user-authorized one-time reset; ordinary initialization remains non-destructive. |
| Multiple frontends and one or more backends | T01, T04, T05 | Three frontends, shared API, separately runnable worker. |
| React/Node/Postgres | T01–T04 | Apps build and real SQL query/migrations pass. |
| Drizzle ORM and Studio | T03 | Migrations from empty DB and locally usable Studio. |
| Turborepo and pnpm | T01–T02 | Workspace commands and dependency/task graph. |
| Biome formatting/linting | T01, every task | Shared Biome checks across workspace code. |
| shadcn via npx; default styles; Tailwind | T01, UI tasks | CLI-generated shared components rendered in borrower/staff shells. |
| Podman DB, simple initialization/env setup | T02–T03 | Initialize twice without loss; env creation and DB access. |
| pnpm dev starts projects and checks DB | T02, T05, T22 | Bad credentials prevent launch; all processes start with healthy DB. |
| Mock existing bank site with apply button | T08 | Navigate bank site → borrower start flow. |
| Minimal application and early email capture | T06–T08 | T06 records a pending contact and verifies email without creating an application. Pending drafts and claims remain T07–T08. |
| Business name, industry code, amount, later fields | T07–T08, T12, T15 | One question per setup screen, optional NAICS, later EIN/SSN requirements. |
| Required initial setup page before the borrower portal | T07–T09, T22 | Planned: dedicated wizard, simple single questions, step indicator, final confirmation, and server-validated completion before portal entry. |
| Track setup state and resume later | T07–T08, T18, T22 | Planned: answers and current/completed/skipped steps persist together; fresh authentication after browser/device loss returns to the same application and question. |
| Portal shows remaining tasks after setup | T09, T12–T14, T17, T19 | Planned: completed setup opens remaining work; incomplete setup cannot bypass the gate through UI or API. Setup completion does not submit or approve the application. |
| No password now; possible bank SSO/API later | T06–T07; decisions | T06 verifies local Mailpit links, deliberate POST, origin/CSRF checks, hashed single-use tokens, revocable sessions and explicit staff membership in both HTTP transports. Creation use case remains T07. |
| Demo sign-in by entering email without visiting an inbox | T06, T07–T08; decisions | Local default uses a labelled demo session, synthetic-only identities/banks, and existing permissions; it does not mark an email verified. Email links remain optional. T07–T08 must preserve this demo entry path. |
| Client or bank-originated applications | T07, T08, T10 | Same service creates drafts from both paths with source recorded; staff can prefill, but applicant confirms and finishes setup. |
| Small through large businesses, $10k through $5m+ | T03, T07, T12, T22 | Exact amounts and $7.5m fixture; configuration-driven requirements. |
| Client dashboard for multiple loans/applications | T09, T20 | Separate application cards and funded-account summaries per business; unfinished drafts resume setup without blocking another completed application's portal. |
| Tasks, uploads, signing on dashboard | T12–T14, T17 | Assigned next actions, evidence review, multi-signer completion. |
| Owners and third parties can be added | T11 | Scoped invitations, own private information, revoked-access denial. |
| Staff can add users and inspect all work | T10–T11, T21 | Bank-scoped participants, process history, jobs, task state. |
| Background fraud/identifier checks | T05, T15–T16 | Missing-input waiting, delayed checks, retries/stale-result tests. |
| Detect missing documents | T12, T14, T16 | Requirements reconcile against reviewed evidence without duplicates. |
| Drag-and-drop uploads in both dashboards | T13 | Same authorized upload flow from borrower and bank UI. |
| AI/OCR categorization and tabs | T14 | Delayed fake classification, grouped tabs, unknown/correction flows. |
| Notify and re-engage applicants | T06, T18 | T06 delivers local access links with durable retries and shared sibling consumption; no raw token is persisted in jobs. Recurring reminders remain T18. |
| Third-party stubs with realistic durations | T05, T14–T18 | Configured delays, deterministic scenarios, fake-clock tests. |
| Approval and funding in first release | T19–T20 | Guarded decisions, closing conditions, one simulated funded account. |
| Servicing later | Product scope and decisions | No balances/repayment/collections logic in initial backlog. |
| Small, understandable, testable work units | T01–T22 | Dependencies, acceptance criteria, targeted checks, implementation record. |
| Agents know where to find instructions | Root AGENTS.md | Links to plan index, task process, conventions, and reference documents. |
