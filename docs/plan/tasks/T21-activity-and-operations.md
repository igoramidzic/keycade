# T21 — Activity history and background operations workspace

Dependencies: T10, T14, T16, T17, T18, T20. Read [audit rules](../03-domain-and-access.md#data-integrity-and-privacy).

## Outcome

Borrowers understand visible progress, and bank staff can diagnose a stuck process from one application workspace.

## Scope

- Build a safe activity projection from existing events with pagination, timestamps, actor labels, and readable descriptions.
- Filter borrower history by current application/task/document scope; staff sees authorized internal workflow details.
- Add bank operations views for document processing, checks, signing, notification delivery, retries, worker heartbeat, and outbox backlog.
- Provide only allowlisted, audited retry/cancel actions that call existing use cases and validate current input/state.
- Add correlation IDs linking a user-visible failure to safe structured logs, without exposing raw queue payloads or secrets.

## Acceptance criteria

- The application history explains creation, invitations, submissions, document review, checks, decisions, and funding in stable order.
- Private owner evidence, staff notes, internal check findings, and other participants' restricted tasks never leak through activity descriptions or counts.
- Staff can distinguish waiting-for-input, pending, retrying, stale, and terminal failure.
- A missing worker or growing backlog is visible; retrying uses current authorized input and cannot duplicate completed effects.
- Old entries remain auditable after participant removal, document replacement, or rule changes.
- Bank A operations routes cannot inspect Bank B queue/business metadata.

## Validation

Test projection filtering for each persona, event pagination/tie ordering, safe log output, operator actions, and offline-worker/stuck-job scenarios. Demonstrate a failed document/check run, staff retry, and successful completion reflected in activity.

Underlying audits and diagnostics were implemented with each feature; this task assembles their coherent UI. External monitoring infrastructure is deferred.

## Implementation record

### October 7, 2026

Both dashboards now expose a paginated activity projection. Authored descriptions and generic actor labels are the only display content; raw audit metadata, notes, addresses, identifiers, provider findings and document contents never enter the response. Borrower filtering uses current task, document, check and intended-signer permissions before pagination, with no hidden-event totals. Staff support references are validated request UUIDs. A PostgreSQL microsecond timestamp plus UUID cursor preserves stable ordering without skipping events that share a JavaScript millisecond.

The staff Operations section combines document scans/interpretation, checks, signatures, notification delivery, worker heartbeat and application-scoped backlog. It distinguishes missing inputs, retrying, superseded and failed work. Retry/void controls call existing audited use cases after checking current eligibility; there is no generic queue reset. The native scheduler records a safe heartbeat after dispatch. All reads and actions recheck bank membership and application access; failed refreshes hide stale content.

Six PostgreSQL tests verify privacy, current grants after replacement/revocation, cross-bank denial, setup guards, exact cursor ordering, safe references, offline workers, scan retry recovery, waiting checks and overdue outbox scope. Two HTTP tests verify both runtimes, query validation, CSRF and nonstaff denial. The complete 347-test PostgreSQL suite, lint/types, 272 unit tests and 12 builds pass. The four desktop/mobile cases passed in `.local/e2e-D7lQlU/summary.json`: failed scan → staff retry → clean scan → correctly filtered activity, plus failed-refresh concealment and retry. Screenshots were inspected for hierarchy and mobile overflow. Native API/jobs Wrangler dry runs also passed. T21 is complete locally; T22 checks the integrated hosted experience.
