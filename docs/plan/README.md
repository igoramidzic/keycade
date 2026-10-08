# Keycade implementation plan

**V2-01 — [expanded setup](v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) is complete locally, October 8, 2026.** Address, optional encrypted EIN/website, illustrated multi-select purposes, legacy upgrade and lender prefill are verified: 305 unit tests, 393 PostgreSQL tests, all 12 builds/typechecks and 36 desktop/mobile browser cases. The local database is migrated and the demo is ready to test. V2-02–V2-08 remain **Not started**; V2-02 is the next default task. No v2 hosted deployment is claimed.

Planning baseline: October 6, 2026. The first local-foundation milestone (T01–T05) is complete and verified. Cloudflare is the intended deployment target; five Keycade Workers are deployed and their Neon/Hyperdrive connections are verified. Neon PostgreSQL is linked and migrated through GitHub Actions; the initial apply and repeat no-op run passed. Separate CI validation is paused for faster demo deployment at the user's request.

Current handoff: **T01–T22 and D01–D04 are complete.** The first release supports application setup, collaboration, private evidence, simulated checks and signatures, human decisions, closing, one recorded simulated funding event, scoped account summaries, activity and operations. See [the developer/demo guide](../../README.md) and [T22 acceptance](tasks/T22-acceptance.md).

The [lender-only invitations follow-up](tasks/T11-participants.md#lender-only-invitations-and-task-assignments--october-8-2026) is complete locally: invitation controls are exclusive to the lender application, and selected tasks become assignments on acceptance. Validation covers 298 unit tests, 368 PostgreSQL cases, all 12 builds and six desktop/mobile invitation journeys. Hosted deployment is not included.

The requested [D05 scenario kit](tasks/D05-demo-scenarios.md) is complete locally: a fixed demo panel, three guided scenarios, twelve generated synthetic PDFs, and content-bound simulated findings. Validation passed 297 unit tests, 355 PostgreSQL tests, all builds/typechecks, and 46 relevant desktop/mobile cases. D05 has not been deployed to the hosted URLs.

The [officer-started borrower handoff](tasks/T10-bank-workspace.md#officer-started-application-handoff--october-7-2026) is refined and verified locally: email-only or partially prefilled applications save their details and one simulated continuation atomically; ambiguous responses recover the same draft. The borrower still confirms and completes setup. Validation passed 298 unit tests, 364 PostgreSQL tests, all 12 builds and 16 desktop/mobile staff cases. This follow-up has not been deployed.

Acceptance covers all eight required journeys: repeatable clean setup and database restart/failure checks, 140 core desktop/mobile browser cases, affected regressions after the closing-read fix, and actual hosted sign-in, setup, R2 documents, invitations, enrichment, two-party signing and recorded funding. The combined implementation at `d7a6597` has 283 unit tests, 350 PostgreSQL tests and all 12 builds passing; all five native Cloudflare builds succeeded. The hosted funding command was replayed without creating a second account, and restricted account access stayed denied.

The [task preload and quieter dashboard](tasks/T12-tasks-and-requirements.md#upfront-task-details-and-quieter-dashboard--october-7-2026) and [hosted demo access](tasks/D03-hosted-demo-parity.md) address the user's follow-ups. The separately requested [request-efficiency work](tasks/D04-hosted-performance.md) records session/polling and database-placement improvements. The hosted Closing request fell from 7.958 seconds to 1.527 seconds in the same-application acceptance probe; the recorded page timings explicitly include test pacing.

The [October 7 hosted-demo clarification](tasks/D03-hosted-demo-parity.md) applies to every environment: production remains a simulation, with local-equivalent demo sign-in and simulated email. D03 resolved the hosted `AUTH_DELIVERY_UNAVAILABLE` gap and verified the synthetic inbox on the production URLs.

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
| V2-02 | [Borrower task dashboard without top tabs](v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) | V2-01; existing borrower/task/signing/review/closing work and D05 | Not started |
| V2-03 | [Filename-driven demo text importer](v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) | T13, T14, D05 | Not started |
| V2-04 | [Document workspace and reviewed financial facts](v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) | V2-01, V2-03; T14, T15, T19 | Not started |
| V2-05 | [Lender overview and evidence drilldowns](v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) | V2-01, V2-04; T10, T12, T16, T19, T21 | Not started |
| V2-06 | [Simulated Loan Footprint map](v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint) | V2-01, T16 | Not started |
| V2-07 | [Integrated local acceptance](v2/04-delivery-and-validation.md#v2-07--integrated-local-acceptance) | V2-02–V2-06, T22 | Not started |
| V2-08 | [Hosted parity](v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) | V2-07, D02, D03 | Not started |

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
| D05 | [Scenario kit and synthetic document demonstrations](tasks/D05-demo-scenarios.md) | T08, T11–T14, T16–T21 | Done — fixed panel, twelve synthetic PDFs and simulated findings; [local acceptance](tasks/D05-demo-scenarios.md#validation) passed. Hosted deployment is not included. |
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
