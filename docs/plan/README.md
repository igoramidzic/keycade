# Keycade implementation plan

**V2-08 — [hosted parity](v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) is complete, October 8, 2026. All V2-01–V2-08 tasks are complete.** The combined v2 demo is deployed through all five native Workers at `75b1f96`. Validation passes **419 unit tests, 484 PostgreSQL cases, all 12 workspace builds/typechecks, five Worker builds and six distinct hosted desktop cases**. The hosted slice verifies setup/resume and EIN masking, protected imports/R2 bytes, explicit financial review, Loan Footprint, stale/replay handling and scoped denial. All 25 migrations are applied; repeat execution changes nothing and preserves existing synthetic records. V2-07 retains the broader **136-case desktop/mobile** local acceptance record.

V2-06 delivered the informational, address-bound Loan Footprint dialog; its [task record](v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint) retains that checkpoint's validation evidence.

V2-04 delivered private document preview, explicit financial acceptance/rejection/correction, immutable provenance and frozen decision references. Its [local acceptance](v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) records **367 unit tests, 442 PostgreSQL tests, all 12 builds/typechecks and 46 distinct desktop/mobile browser cases** at that checkpoint. The [modal preview stability follow-up](v2/04-delivery-and-validation.md#modal-preview-stability--october-8-2026) is complete locally: the scrollbar-driven redraw loop is fixed, with all 16 document-workspace browser cases, 373 unit tests and all 12 builds/typechecks passing.

V2-03 delivered five registered text filenames that generate synthetic PDFs with exact-byte validation, retained recipe/application snapshots and typed simulated findings through the protected upload pipeline. Its [local acceptance](v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) records **362 unit tests, 418 PostgreSQL tests, all 12 builds/typechecks and 40 desktop/mobile browser cases** at that checkpoint.

V2-02 delivered the borrower task dashboard with personal/assigned/business tasks, persisted-stage progress, sidebar uploads and contextual documents, signing, submission, closing, people and history. Its [local acceptance](v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) records the historical validation boundary.

Planning baseline: October 6, 2026. The first local-foundation milestone (T01–T05) is complete and verified. Cloudflare is the intended deployment target; five Keycade Workers are deployed and their Neon/Hyperdrive connections are verified. Neon PostgreSQL is linked and migrated through GitHub Actions; the initial apply and repeat no-op run passed. Separate CI validation is paused for faster demo deployment at the user's request.

Current handoff: **T01–T22 and D01–D04 are complete.** The first release supports application setup, collaboration, private evidence, simulated checks and signatures, human decisions, closing, one recorded simulated funding event, scoped account summaries, activity and operations. See [the developer/demo guide](../../README.md) and [T22 acceptance](tasks/T22-acceptance.md).

The [lender-only invitations follow-up](tasks/T11-participants.md#lender-only-invitations-and-task-assignments--october-8-2026) is complete locally: invitation controls are exclusive to the lender application, and selected tasks become assignments on acceptance. Validation covers 298 unit tests, 368 PostgreSQL cases, all 12 builds and six desktop/mobile invitation journeys. Included in the V2-08 hosted deployment.

The requested [D05 scenario kit](tasks/D05-demo-scenarios.md) is complete locally: a fixed demo panel, three guided scenarios, twelve generated synthetic PDFs, and content-bound simulated findings. Validation passed 297 unit tests, 355 PostgreSQL tests, all builds/typechecks, and 46 relevant desktop/mobile cases. D05 is included in the V2-08 hosted deployment and its protected importer journey.

The [officer-started borrower handoff](tasks/T10-bank-workspace.md#officer-started-application-handoff--october-7-2026) is refined and verified locally: email-only or partially prefilled applications save their details and one simulated continuation atomically; ambiguous responses recover the same draft. The borrower still confirms and completes setup. Validation passed 298 unit tests, 364 PostgreSQL tests, all 12 builds and 16 desktop/mobile staff cases. This follow-up is included in V2-08; its hosted slice verifies officer-prefilled unfinished setup.

Acceptance covers all eight required journeys: repeatable clean setup and database restart/failure checks, 140 core desktop/mobile browser cases, affected regressions after the closing-read fix, and actual hosted sign-in, setup, R2 documents, invitations, enrichment, two-party signing and recorded funding. The combined implementation at `d7a6597` has 283 unit tests, 350 PostgreSQL tests and all 12 builds passing; all five native Cloudflare builds succeeded. The hosted funding command was replayed without creating a second account, and restricted account access stayed denied.

The [task preload and quieter dashboard](tasks/T12-tasks-and-requirements.md#upfront-task-details-and-quieter-dashboard--october-7-2026) and [hosted demo access](tasks/D03-hosted-demo-parity.md) address the user's follow-ups. The separately requested [request-efficiency work](tasks/D04-hosted-performance.md) records session/polling and database-placement improvements. The hosted Closing request fell from 7.958 seconds to 1.527 seconds in the same-application acceptance probe; the recorded page timings explicitly include test pacing.

The [October 7 hosted-demo clarification](tasks/D03-hosted-demo-parity.md) applies to every environment: production remains a simulation, with local-equivalent demo sign-in and simulated email. D03 resolved the hosted `AUTH_DELIVERY_UNAVAILABLE` gap and verified the synthetic inbox on the production URLs.

The requested [shorter task cards](v2/04-delivery-and-validation.md#shorter-task-cards--october-8-2026) follow-up is complete on `main`: the task list sits on the page with each task as its own card, tasks keep a fixed stage order, answer tasks show their question with details collapsed at the bottom, and shared borrower tasks rely on the sidebar uploader. All 12 typechecks, 419 unit tests and 72 distinct desktop/mobile browser cases passed locally.

The requested [readable default typography](v2/04-delivery-and-validation.md#readable-default-typography--october-8-2026) follow-up is complete locally: regular compact text is 16px and secondary text/small buttons are 14px at default browser settings. Six desktop/mobile layout cases, 373 unit tests and all 12 builds/typechecks passed.

The requested [KeyBank palette follow-up](tasks/D06-design-system-redesign.md#keybank-palette-follow-up--october-8-2026) is complete locally: shared red accents, charcoal text and neutral white/gray surfaces replace sapphire across all four interfaces. All three web builds, 10 desktop/mobile smoke tests and light/dark brand/neutral contrast checks pass. The broader D06 redesign remains in progress.

The [blue action/status refinement](tasks/D06-design-system-redesign.md#blue-action-and-status-follow-up--october-8-2026) is complete locally: routine actions and current states use blue while KeyBank branding stays red. All three web builds, four affected typechecks, 22 isolated desktop/mobile browser cases, Biome and light/dark contrast checks pass.

The [primary-button clarification](tasks/D06-design-system-redesign.md#red-primary-buttons-with-blue-status--october-8-2026) is complete locally: red primary buttons are restored while routine application status and selection stay blue. Three web builds, four affected typechecks, eight isolated desktop/mobile cases and contrast checks pass.

The requested [charcoal demo kit](tasks/D06-design-system-redesign.md#charcoal-demo-kit--october-8-2026) is complete locally: the demo sidebar is a charcoal “Demo only” console organized as numbered steps, with the upload destination and expected sample outcomes visible up front. Three web builds, three typechecks, Biome and 44 isolated desktop/mobile kit cases pass.

The [website-step refinement](v2/04-delivery-and-validation.md#website-entry-and-focused-question--october-8-2026) is complete locally: bare domains normalize to HTTPS, and the website question no longer repeats the saved NAICS selection. Validation passes 81 contract tests, one targeted PostgreSQL persistence case, six desktop/mobile cases, affected typechecks and the borrower build.

The requested [prefilled answers modal](tasks/T10-bank-workspace.md#prefilled-answers-modal--october-8-2026) is complete locally: the editor opens above the overview in a scrolling modal with keyboard dismissal and focus return. Both desktop/mobile staff journeys, bank-console typecheck/build and targeted Biome checks pass.

The requested [participants redesign](tasks/T11-participants.md#participants-cards-menus-and-modals--october-8-2026) is complete locally: lender Participants shows people and invitations as cards with “⋯” action menus, invite/owner/link/edit-tasks dialogs and confirmed removal. [Overview now includes the task list](tasks/T10-bank-workspace.md#overview-task-list--october-8-2026). Buttons show an [in-button spinner](tasks/D06-design-system-redesign.md#dialogs-menus-and-in-button-spinners--october-8-2026) instead of “Saving…” text. Setup has [per-step URLs and whole-dollar amount entry](v2/04-delivery-and-validation.md#whole-dollar-amounts-and-addressable-setup-steps--october-8-2026). Lint, all affected typechecks, 425 unit tests and three web builds pass. Of 74 isolated desktop/mobile cases, 65 passed and 8 opt-in inbox cases were skipped. One queue case failed only from data accumulated across the combined run, then passed when rerun alone.

The requested [client task completion without a review step](tasks/T12-tasks-and-requirements.md#client-completion-without-a-review-step--october-9-2026) and [animated disclosures](tasks/D06-design-system-redesign.md#animated-disclosures--october-9-2026) are complete locally. Lint, typechecks, 426 unit tests and 485 PostgreSQL cases pass. A full 228-case desktop/mobile browser sweep found no product regressions. Its failures were stale selectors, now fixed, and cross-spec data accumulation, and every affected spec passes on its own on the final code.

The requested [account picker and product wording](tasks/D07-account-picker-and-product-copy.md) follow-up is **complete locally; production publication pending**: lender accounts are selected from existing bank memberships, and all product screens use neutral wording. The underlying services remain simulated. The email-link switch, example email and obsolete hosted-delivery notice are removed from both sign-in surfaces. Validation passes 426 unit tests, 487 PostgreSQL cases, 48 distinct relevant browser cases, all 12 builds/typechecks, lint and five Cloudflare dry runs.

## Agreed outcome

Build a bank-operated business lending platform with a mock bank website, a borrower application/dashboard, and a bank staff console. Support multiple businesses, participants, applications, and eventual loan accounts. Ask for email first, progressively collect information, and use passwordless access. Simulate outside services with visible delays and reliable background processing.

Borrowers start in a dedicated initial loan-application setup wizard that asks one simple question per screen and persists answers and progress for later resume. They must finish setup before entering that application's portal to see and complete remaining tasks. This is a per-application gate, separate from submission, approval, and funding; see [the setup contract](01-product.md#initial-setup-wizard-and-portal-entry). The October 6 clarification is implemented in the T07 backend and T08 wizard; T09 expands the portal handoff. Their existing dependency order remains appropriate.

The user confirmed that the first version ends at approval and funding. Ongoing servicing is a later phase. Initial funding is a recorded simulation, with no movement of money.

## Read in this order

1. [Product scope and journeys](01-product.md)
2. [Architecture](02-architecture.md)
3. [Domain and access rules](03-domain-and-access.md)
4. [Integration and job contracts](04-integrations-and-jobs.md)
5. [Development and testing](05-development-and-testing.md)
6. [Decisions and sources](06-decisions-and-sources.md)
7. [Requirement-to-task map](07-requirements-map.md)

## How to use a task

Implement one task or one coherent slice at a time. Each task defines prerequisites, a bounded change, observable acceptance criteria, and validation. Intermediate tasks may expose an API or use fixtures before their dependent screens exist. Fixtures must be visibly synthetic demo data in every environment.

Create tables and packages when the owning task needs them; the architecture tree describes the intended destination. Tests and migrations belong with each change. The last task verifies the combined experience rather than introducing all testing at once.

Use `Not started`, `In progress`, `Blocked — reason`, or `Done — evidence`. After completion, add the date, relevant commands and results, and remaining limitations to the task's implementation record. Dependencies mean the referenced acceptance criteria have passed, not simply that files exist.

## Backlog

### Active version 2 backlog

Read the [v2 experience](v2/02-experience-spec.md) and [data/simulation contract](v2/03-data-and-simulation.md) first. Full dependencies, acceptance criteria and unstarted implementation records are in [v2 delivery and validation](v2/04-delivery-and-validation.md).

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| V2-01 | [Expanded setup and migration](v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) | T07, T08, T15 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) |
| V2-02 | [Borrower task dashboard without top tabs](v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) | V2-01; existing borrower/task/signing/review/closing work and D05 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) |
| V2-03 | [Filename-driven demo text importer](v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) | T13, T14, D05 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) |
| V2-04 | [Document workspace and reviewed financial facts](v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) | V2-01, V2-03; T14, T15, T19 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) |
| V2-05 | [Lender overview and evidence drilldowns](v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) | V2-01, V2-04; T10, T12, T16, T19, T21 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) |
| V2-06 | [Simulated Loan Footprint map](v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint) | V2-01, T16 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint) |
| V2-07 | [Integrated local acceptance](v2/04-delivery-and-validation.md#v2-07--integrated-local-acceptance) | V2-02–V2-06, T22 | Done — [local acceptance](v2/04-delivery-and-validation.md#v2-07--integrated-local-acceptance) |
| V2-08 | [Hosted parity](v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) | V2-07, D02, D03 | Done — [hosted acceptance](v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) |

### Completed baseline backlog

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| T01 | [Workspace and app shells](tasks/T01-workspace.md) | — | Done — [validated](local-foundation-validation.md) |
| T02 | [Podman, environment, and local commands](tasks/T02-local-environment.md) | T01 | Done — [validated](local-foundation-validation.md) |
| T03 | [Drizzle, core schema, and seeds](tasks/T03-database.md) | T02 | Done — [validated](local-foundation-validation.md) |
| T04 | [API boundaries, authorization, and audit foundation](tasks/T04-api-foundation.md) | T03 | Done — [validated](local-foundation-validation.md) |
| T05 | [Durable jobs and provider contracts](tasks/T05-jobs.md) | T04 | Done — [validated](local-foundation-validation.md) |
| D01 | [Neon connection and GitHub migrations](tasks/D01-neon-migrations.md) | T03, T05 | Done — first hosted apply and faster demo no-op run passed; [evidence](tasks/D01-neon-migrations.md) |
| D02 | [Cloudflare deployment and Neon runtime connection](tasks/D02-cloudflare-deployment.md) | D01, T04, T05 | Done — all five native builds and hosted readiness passed; [hosted intake configuration repaired and verified](tasks/D02-cloudflare-deployment.md#hosted-intake-recovery--october-7-2026). |
| T06 | [Passwordless identity and sessions](tasks/T06-identity.md) | T05, D02 | Done — local demo/email sign-in, revocable sessions, both API transports; [validated](identity-validation.md) |
| T07 | [Application creation, saved setup state, and completion guards](tasks/T07-application-service.md) | T06 | Done — creation, resume, setup guards in both transports; [validated](tasks/T07-application-service.md#validation) |
| T08 | [Mock bank and required setup wizard](tasks/T08-intake.md) | T07 | Done — demo/email intake, resume, recovery, desktop/mobile completion; [validated](tasks/T08-intake.md#implementation-record) |
| T09 | [Borrower dashboard and portal after setup](tasks/T09-borrower-workspace.md) | T08 | Done — grouped summaries, scoped portal and desktop/mobile journeys; [validated](tasks/T09-borrower-workspace.md#implementation-record) |
| T10 | [Bank application queue and workspace](tasks/T10-bank-workspace.md) | T07 | Done — scoped queue, atomic staff creation/prefill/continuation and retry recovery, assignments, audited notes; [handoff validated locally](tasks/T10-bank-workspace.md#officer-started-application-handoff--october-7-2026) |
| T11 | [Participants, owners, and invitations](tasks/T11-participants.md) | T09, T10 | Done — lender-only invitations, selected task assignments, scoped acceptance and revocation; [October 8 validation](tasks/T11-participants.md#lender-only-invitations-and-task-assignments--october-8-2026) |
| T12 | [Tasks and product requirements](tasks/T12-tasks-and-requirements.md) | T11 | Done — scoped task workflows, versioned requirements and review; [validated](tasks/T12-tasks-and-requirements.md#validation-record). [Save-warning flicker fixed](tasks/T12-tasks-and-requirements.md#save-warning-flicker--october-7-2026). |
| T13 | [Private document storage and uploads](tasks/T13-document-upload.md) | T12 | Done — private uploads, scoped downloads, scans and evidence versions; [local validation](tasks/T13-document-upload.md#validation) and [hosted R2 byte-path acceptance](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026). |
| T14 | [Document ingestion and categorization](tasks/T14-document-processing.md) | T05, T13 | Done — delayed interpretation, scoped categories/corrections and desktop/mobile workflows; [validated](tasks/T14-document-processing.md#validation). |
| T15 | [Industry, business, and tax simulations](tasks/T15-enrichment.md) | T05, T08 | Done — complete NAICS search, encrypted synthetic identifiers, explicit tax prerequisites and protected delayed simulations; [validated locally](tasks/T15-enrichment.md#transport-runtime-and-checkpoint-validation). |
| T16 | [Identity/fraud checks and readiness](tasks/T16-checks-and-readiness.md) | T12, T14, T15 | Done — private inputs, scoped checks and stage readiness; [validated](tasks/T16-checks-and-readiness.md#checkpoint-validation). |
| T17 | [Signature requests and simulated signing](tasks/T17-signatures.md) | T05, T11, T12, T13 | Done — protected multi-signer simulation, immutable evidence and emailed continuation; [validated](tasks/T17-signatures.md#checkpoint-validation). |
| T18 | [Notifications and unfinished-application reminders](tasks/T18-notifications.md) | T05, T06, T09, T11, T12 | Done — scoped notification delivery, current continuation and idle suppression; [validated](tasks/T18-notifications.md#checkpoint-validation). |
| D03 | [Hosted demo authentication and delivery parity](tasks/D03-hosted-demo-parity.md) | D02, T06, T18 | Done — private simulated inbox, saved setup, scoped invitation and two-party signing passed on actual production URLs; [evidence](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026). |
| D04 | [Hosted request efficiency and latency](tasks/D04-hosted-performance.md) | D02, D03, T12, T16 | Done — session binding, quieter polling and placement validated; [deployed serial/concurrent timings](tasks/D04-hosted-performance.md#hosted-remeasurement--october-7-2026) record improvements and remaining latency. |
| D05 | [Scenario kit and synthetic document demonstrations](tasks/D05-demo-scenarios.md) | T08, T11–T14, T16–T21 | Done — fixed panel, twelve synthetic PDFs and simulated findings; [local acceptance](tasks/D05-demo-scenarios.md#validation) passed. Included in the V2-08 hosted deployment. |
| T19 | [Submission, review, and decisions](tasks/T19-review-and-decisions.md) | T10, T12, T16 | Done — guarded decisions, immutable history and desktop/mobile review journeys; [validation](tasks/T19-review-and-decisions.md#implementation-record). |
| T20 | [Closing and recorded funding](tasks/T20-closing-and-funding.md) | T17, T19 | Done — guarded closing, current signatures, atomic simulated funding and scoped accounts; [validated](tasks/T20-closing-and-funding.md#implementation-record). |
| T21 | [Activity and operations workspace](tasks/T21-activity-and-operations.md) | T10, T14, T16, T17, T18, T20 | Done — safe paginated history, scoped diagnostics and audited retry recovery; [validated](tasks/T21-activity-and-operations.md#implementation-record). |
| T22 | [End-to-end acceptance and handoff](tasks/T22-acceptance.md) | T01–T21, D03 | Done — eight required journeys, clean setup/restart, 140 core browser cases and actual hosted simulated funding; [evidence](tasks/T22-acceptance.md). Separate CI checks remain paused by user instruction. |

The table gives a default sequence; dependencies allow parallel work. For example, T10 can proceed alongside T08–T09, and T15 can proceed alongside T11–T14. Agree shared contracts before parallel implementation. T17 and T18 can proceed independently after their prerequisites.

## Demonstrable milestones

| Milestone | Required tasks | Demonstration |
| --- | --- | --- |
| Local foundation | T01–T05 | One initialization command; all shells launch; database, Studio, and restart-safe worker are usable. |
| Start and resume | T06–T10 | Mock bank → email-first access → one-question setup wizard → leave/resume saved step → finish setup → remaining-task portal; bank staff can see drafts throughout. |
| Collaborate and collect | T11–T14 | Invite an owner/lawyer; assign requirements; upload on either dashboard; categorized documents appear. |
| Checks and decisions | T15–T19 plus prerequisites | Simulated checks, signatures, reminders, submission, and human review work with failures and retries. |
| Close and demonstrate | T20–T22 | Record simulated funding, see the resulting loan account, inspect history, and run the full acceptance suite. |

## Global definition of done

- The selected task's criteria pass, including its negative/error cases.
- User-visible states cover loading, empty, denied, retryable failure, and success where applicable.
- New reads and writes enforce authorization, validate input/output, and emit safe audit records where consequential.
- Persistent changes include migrations, representative synthetic fixtures, and suitable tests.
- The change builds and passes the relevant Biome, type, and test checks; validation evidence is recorded.
- Future features remain explicitly deferred. No real provider calls or production deployment are required for this first release.
