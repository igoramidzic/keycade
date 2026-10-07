# Keycade implementation plan

Planning baseline: October 6, 2026. The first local-foundation milestone (T01–T05) is complete and verified. Cloudflare is the intended deployment target; five Keycade Workers are deployed and their Neon/Hyperdrive connections are verified. Neon PostgreSQL is linked and migrated through GitHub Actions; the initial apply and repeat no-op run passed. Separate CI validation is paused for faster demo deployment at the user's request.

Current handoff: [demo sign-in and identity test guide](identity-validation.md). T06 is complete locally, including the user's immediate demo sign-in override. The October 7 [shared-page cleanup](tasks/T01-workspace.md#ui-cleanup--october-7-2026) is also complete. T07 application creation, saved setup state, and completion guards are complete and [validated](tasks/T07-application-service.md#validation). T08 adds the mock bank, email-first start, resumable one-question setup, and completion routing; [validation](tasks/T08-intake.md#implementation-record). The [October 7 intake feedback](tasks/T08-intake.md#copy-cleanup--october-7-2026) simplifies question copy; [fixed-product intake](tasks/T08-intake.md#fixed-product--october-7-2026) removes product choice and always assigns Synthetic Business Credit. The searchable NAICS combobox is now implemented in [T15](tasks/T15-enrichment.md). T09 adds the business-grouped borrower dashboard and guarded portal sections; [validation](tasks/T09-borrower-workspace.md#implementation-record). T10 adds the staff queue, application workspace, local continuation delivery, assignments, and private notes; [validation](tasks/T10-bank-workspace.md#implementation-record). The October 7 [local sign-in recovery](tasks/T10-bank-workspace.md#local-sign-in-recovery--october-7-2026) restores persistent Podman availability and adds safe retryable outage responses. The start-and-resume milestone is complete. T11 adds independent owner records, scoped invitations with verified email acceptance, and immediate participant revocation on both dashboards; [validation](tasks/T11-participants.md#implementation-record). T12 adds pinned product requirements, scoped task lists/progress, private owner confirmations, manual requests, evidence revisions, staff review/waivers, and assignment revocation across reinvitations; [validation](tasks/T12-tasks-and-requirements.md#validation-record). The October 7 [dashboard reference layout](tasks/T12-tasks-and-requirements.md#dashboard-reference-layout--october-7-2026) adds the wider borrower workspace, inline task checklist on the left, and application-details sidebar on the right. T13 adds private streamed uploads, quarantined scans, immutable versions and task evidence on both dashboards; [validation](tasks/T13-document-upload.md#validation). T14 adds delayed simulated interpretation, scoped category tabs, extracted suggestions, processing history and staff corrections; [validation](tasks/T14-document-processing.md#validation). T15 adds the complete 1,012-entry Census 2022 industry catalog, private encrypted synthetic identifiers, explicit tax authorization and protected business/tax simulation APIs; [validation](tasks/T15-enrichment.md#transport-runtime-and-checkpoint-validation). The second checkpoint passed 256 unit tests, 228 PostgreSQL integration tests and 8 new desktop/mobile document-processing journeys. The private R2 byte path was subsequently verified on the hosted demo in [D03](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026); hosted identifier/enrichment acceptance remains unverified. The [upfront-task/dashboard refinement](tasks/T12-tasks-and-requirements.md#upfront-task-details-and-quieter-dashboard--october-7-2026) loads task details before expansion and simplifies dashboard surfaces. T16–T18 now add private synthetic inputs and stage readiness, simulated two-party signing, and contextual notifications/reminders; [checks](tasks/T16-checks-and-readiness.md#checkpoint-validation), [signatures](tasks/T17-signatures.md#checkpoint-validation), [notifications](tasks/T18-notifications.md#checkpoint-validation). The checkpoint passed 270 unit tests, 290 PostgreSQL tests, 8 new browser journeys and 18 browser regressions. T19 now implements guarded human review and immutable submission/decision history, verified in PostgreSQL, both HTTP runtimes and desktop/mobile browsers. D03 adds a private simulated inbox and enables hosted demo access; [actual production-URL acceptance passed](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026), including saved setup, scoped invitation, private R2 documents and two-party simulated signing. T20 closing/funding and T21 activity/operations are complete locally: 272 unit tests, 347 PostgreSQL tests, 12 builds, six new desktop/mobile cases and 18 borrower regressions passed. Next: **T22 — Integrated acceptance and handoff**, including deployed closing/funding and final full browser regressions.

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

Implement one task or one coherent slice at a time. Each task defines prerequisites, a bounded change, observable acceptance criteria, and validation. Intermediate tasks may expose an API or use fixtures before their dependent screens exist. Fixtures must be visibly local development data.

Create tables and packages when the owning task needs them; the architecture tree describes the intended destination. Tests and migrations belong with each change. The last task verifies the combined experience rather than introducing all testing at once.

Use `Not started`, `In progress`, `Blocked — reason`, or `Done — evidence`. After completion, add the date, relevant commands and results, and remaining limitations to the task's implementation record. Dependencies mean the referenced acceptance criteria have passed, not simply that files exist.

## Backlog

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
| T10 | [Bank application queue and workspace](tasks/T10-bank-workspace.md) | T07 | Done — scoped queue, staff creation/continuation, assignments, audited notes; [validated](tasks/T10-bank-workspace.md#implementation-record) |
| T11 | [Participants, owners, and invitations](tasks/T11-participants.md) | T09, T10 | Done — owner relationships, scoped invitations, verified acceptance and immediate revocation; [validated](tasks/T11-participants.md#implementation-record) |
| T12 | [Tasks and product requirements](tasks/T12-tasks-and-requirements.md) | T11 | Done — scoped task workflows, versioned requirements and review; [validated](tasks/T12-tasks-and-requirements.md#validation-record). [Save-warning flicker fixed](tasks/T12-tasks-and-requirements.md#save-warning-flicker--october-7-2026). |
| T13 | [Private document storage and uploads](tasks/T13-document-upload.md) | T12 | Done — private uploads, scoped downloads, scans and evidence versions; [local validation](tasks/T13-document-upload.md#validation) and [hosted R2 byte-path acceptance](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026). |
| T14 | [Document ingestion and categorization](tasks/T14-document-processing.md) | T05, T13 | Done — delayed interpretation, scoped categories/corrections and desktop/mobile workflows; [validated](tasks/T14-document-processing.md#validation). |
| T15 | [Industry, business, and tax simulations](tasks/T15-enrichment.md) | T05, T08 | Done — complete NAICS search, encrypted synthetic identifiers, explicit tax prerequisites and protected delayed simulations; [validated locally](tasks/T15-enrichment.md#transport-runtime-and-checkpoint-validation). |
| T16 | [Identity/fraud checks and readiness](tasks/T16-checks-and-readiness.md) | T12, T14, T15 | Done — private inputs, scoped checks and stage readiness; [validated](tasks/T16-checks-and-readiness.md#checkpoint-validation). |
| T17 | [Signature requests and simulated signing](tasks/T17-signatures.md) | T05, T11, T12, T13 | Done — protected multi-signer simulation, immutable evidence and emailed continuation; [validated](tasks/T17-signatures.md#checkpoint-validation). |
| T18 | [Notifications and unfinished-application reminders](tasks/T18-notifications.md) | T05, T06, T09, T11, T12 | Done — scoped notification delivery, current continuation and idle suppression; [validated](tasks/T18-notifications.md#checkpoint-validation). |
| D03 | [Hosted demo authentication and delivery parity](tasks/D03-hosted-demo-parity.md) | D02, T06, T18 | Done — private simulated inbox, saved setup, scoped invitation and two-party signing passed on actual production URLs; [evidence](tasks/D03-hosted-demo-parity.md#hosted-acceptance--october-7-2026). |
| D04 | [Hosted request efficiency and latency](tasks/D04-hosted-performance.md) | D02, D03, T12, T16 | In progress — production bottleneck reproduced; local session/polling/placement changes validated; deployed speedup remains unverified. |
| T19 | [Submission, review, and decisions](tasks/T19-review-and-decisions.md) | T10, T12, T16 | Done — guarded decisions, immutable history and desktop/mobile review journeys; [validation](tasks/T19-review-and-decisions.md#implementation-record). |
| T20 | [Closing and recorded funding](tasks/T20-closing-and-funding.md) | T17, T19 | Done — guarded closing, current signatures, atomic simulated funding and scoped accounts; [validated](tasks/T20-closing-and-funding.md#implementation-record). |
| T21 | [Activity and operations workspace](tasks/T21-activity-and-operations.md) | T10, T14, T16, T17, T18, T20 | Done — safe paginated history, scoped diagnostics and audited retry recovery; [validated](tasks/T21-activity-and-operations.md#implementation-record). |
| T22 | [End-to-end acceptance and handoff](tasks/T22-acceptance.md) | T01–T21, D03 | In progress — final browser/hosted journeys and clean-setup handoff. Separate CI checks remain paused by user instruction. |

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
