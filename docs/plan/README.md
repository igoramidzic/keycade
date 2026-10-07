# Keycade implementation plan

Planning baseline: October 6, 2026. The first local-foundation milestone (T01–T05) is complete and verified. Cloudflare is the intended deployment target; no Keycade Workers have been provisioned. Neon PostgreSQL is linked and migrated through GitHub Actions; the initial apply and repeat no-op run passed. Separate CI validation is paused for faster demo deployment at the user's request.

Current handoff: [local-foundation validation and test guide](local-foundation-validation.md). Next unfinished task: **T06 — Passwordless identity and sessions**; next coherent milestone: T06–T10.

## Agreed outcome

Build a bank-operated business lending platform with a mock bank website, a borrower application/dashboard, and a bank staff console. Support multiple businesses, participants, applications, and eventual loan accounts. Ask for email first, progressively collect information, and use passwordless access. Simulate outside services with visible delays and reliable background processing.

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
| T06 | [Passwordless identity and sessions](tasks/T06-identity.md) | T05 | Not started |
| T07 | [Application creation and draft service](tasks/T07-application-service.md) | T06 | Not started |
| T08 | [Mock bank and short application flow](tasks/T08-intake.md) | T07 | Not started |
| T09 | [Borrower dashboard and application workspace](tasks/T09-borrower-workspace.md) | T08 | Not started |
| T10 | [Bank application queue and workspace](tasks/T10-bank-workspace.md) | T07 | Not started |
| T11 | [Participants, owners, and invitations](tasks/T11-participants.md) | T09, T10 | Not started |
| T12 | [Tasks and product requirements](tasks/T12-tasks-and-requirements.md) | T11 | Not started |
| T13 | [Private document storage and uploads](tasks/T13-document-upload.md) | T12 | Not started |
| T14 | [Document ingestion and categorization](tasks/T14-document-processing.md) | T05, T13 | Not started |
| T15 | [Industry, business, and tax simulations](tasks/T15-enrichment.md) | T05, T08 | Not started |
| T16 | [Identity/fraud checks and readiness](tasks/T16-checks-and-readiness.md) | T12, T14, T15 | Not started |
| T17 | [Signature requests and simulated signing](tasks/T17-signatures.md) | T05, T11, T12, T13 | Not started |
| T18 | [Notifications and unfinished-application reminders](tasks/T18-notifications.md) | T05, T06, T09, T11, T12 | Not started |
| T19 | [Submission, review, and decisions](tasks/T19-review-and-decisions.md) | T10, T12, T16 | Not started |
| T20 | [Closing and recorded funding](tasks/T20-closing-and-funding.md) | T17, T19 | Not started |
| T21 | [Activity and operations workspace](tasks/T21-activity-and-operations.md) | T10, T14, T16, T17, T18, T20 | Not started |
| T22 | [End-to-end acceptance and handoff](tasks/T22-acceptance.md) | T01–T21 | Not started |

The table gives a default sequence; dependencies allow parallel work. For example, T10 can proceed alongside T08–T09, and T15 can proceed alongside T11–T14. Agree shared contracts before parallel implementation. T17 and T18 can proceed independently after their prerequisites.

## Demonstrable milestones

| Milestone | Required tasks | Demonstration |
| --- | --- | --- |
| Local foundation | T01–T05 | One initialization command; all shells launch; database, Studio, and restart-safe worker are usable. |
| Start and resume | T06–T10 | Mock bank → email link → short application → borrower dashboard and bank queue. |
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
