# Simulated integrations and background jobs

The first release uses fake adapters with realistic asynchronous behavior. They require no external credentials, make no live financial checks, and send no external email. Interface boundaries must allow replacement without rewriting application use cases.

## Provider contracts

Each call includes a bank/application scope, operation ID, input revision, idempotency key, and safe correlation metadata. Each result includes provider name, `simulated` provenance, typed outcome, timestamps, and optional safe evidence. Keep raw sensitive inputs out of queue payloads; jobs fetch authorized current inputs by reference.

| Adapter | Trigger / result | Default demo delay |
| --- | --- | --- |
| Industry search | Search a small versioned NAICS fixture; return code/label suggestions or no match. | 0.3–1.5 seconds |
| Business enrichment | Supplied business details or identifier; return suggested entity facts requiring confirmation. | 2–5 seconds |
| Tax verification | Identifier plus configured authorization prerequisite; return available/missing/unable-to-verify sample tax records. | 10–30 seconds |
| Identity / fraud | Relevant owner/business identifiers complete; return clear/needs-review/unable-to-verify evidence. | 5–20 seconds |
| File scan | Finished upload; return clean/blocked/error before content is usable. | 1–3 seconds |
| OCR / classification | Clean document version; return text/field fixtures, document type, confidence, and review flags. | 5–20 seconds |
| Signature | Create envelope and deliver signing request; complete only after explicit simulated signer actions. | 1–3 seconds to create; signer-controlled completion |
| Email | Deliver to Mailpit via local SMTP; persist accepted/failed status. | 0.2–1 second |

These are illustrative UX delays, not measured vendor service levels. Use per-provider configuration and deterministic jitter. Do not claim a tax ID alone guarantees access to tax records. The tax stub models required inputs and an explicit authorization record without asserting that its demo text satisfies a legal standard.

Industry search is a bounded, read-only local fixture lookup. All longer operations run in the worker; HTTP endpoints acknowledge persisted work immediately. Simulated delays use nonblocking timers. Inject clocks for adapter delays, deadlines, eligibility, and domain scheduling so those tests do not sleep in real time. Real PostgreSQL/pg-boss recovery tests use bounded polling and short test-specific lease/retry timings; a JavaScript fake clock does not advance the database clock.

## Scenario controls

Support explicit fixtures for `success`, `missing_input`, `not_found`, `needs_review`, `low_confidence`, `transient_error`, `timeout`, and `terminal_error` where the adapter supports them. Signature-specific fixtures include partial completion, wrong signer, decline, expiration, void, duplicate event, and reordered event.

Keep scenarios in synthetic seed/test data or protected development tooling. Never allow an unauthenticated request parameter to force a favorable check. Derive fixture results from a registered fixture identity/content hash, not a user-supplied filename such as “approved.pdf.” An unrecognized document produces a clear unknown/needs-review result.

Every result displays “Simulated” in staff views and wherever it could be mistaken for real verification. Preserve provider suggestions and user/staff-confirmed values separately. An AI label may organize a file but may not change a human decision or silently populate a verified financial fact.

## Durable lifecycle

1. A domain transaction writes the business change, audit event, and outbox record.
2. A dispatcher enqueues durable work and marks the outbox entry dispatched. Crashes between these steps may cause duplicate delivery; operation IDs deduplicate effects.
3. A worker claims work, records attempts, loads current authorized inputs, and checks that the operation still applies.
4. It invokes the adapter with a deadline, validates the result, and compares the input revision before applying it.
5. It commits the result and any follow-on outbox events transactionally. UI polling observes persisted state.

No promise of exactly-once delivery is necessary. Observable effects must be idempotent: a duplicate event cannot create a second task, charge anything, send another invitation, overwrite a newer result, or create another funded account.

Queue and integration states are distinct. Maintain an application-owned `IntegrationRun` so callers can see a stable history even when pg-boss cleans internal job rows. Restrict pg-boss internal details to operators.

## Retries, cancellation, and recovery

- Start with configurable three attempts and exponential backoff for transient errors. Define a provider deadline, initially 60 seconds for the demo adapters, distinct from the simulated delay. Permanent validation failures require correction, not blind retries.
- Expose terminal failure and a safe staff retry action. Record who retried, why, and which input revision was used. Only retry an allowed operation, not an arbitrary queue payload supplied by a client.
- A changed identifier or new document version invalidates prior in-flight results. Retain old runs as stale history; they must not overwrite the current result.
- Missing prerequisites produce `waiting_for_input`. Adding the final prerequisite schedules exactly one new current run.
- Withdrawal, revocation, task completion, or a changed decision can make queued work obsolete. Re-check eligibility before each external effect and before applying results.
- Shut down gracefully, release/expire work leases, and prove recovery by restarting workers mid-operation.
- Track worker heartbeat, queue delay, failed attempts, outbox backlog, and stuck operations using safe metadata. T21 adds a usable operations view; T05 supplies the underlying state.

## Document pipeline

Upload → durable metadata and private bytes → quarantine scan → clean content → interpretation → suggested category/extracted fields → staff confirmation where needed → task evidence review.

Use immutable document versions, checksums, safe names, and content-based file validation. Duplicate uploads within an authorized application can show a reuse suggestion; never use cross-bank deduplication responses that reveal another customer's files. Processing failures preserve original bytes and allow authorized retry. Staff recategorization keeps the original simulated classification and audit history.

Once real AI is introduced, document text remains untrusted data; it cannot issue commands, follow arbitrary links, authorize access, or change approval state. The fake adapter should already return schema-validated data rather than free-form instructions.

## Signatures and notifications

Use a DocuSign-shaped provider boundary without choosing a live vendor integration. Simulated envelopes bind immutable document versions and intended signers. Provider events need stable IDs, provider verification at the webhook boundary, deduplication, and legal state transitions. The fake transport has a local shared verification secret and a protected simulator; a public unverified callback cannot complete a signature.

Completion requires all intended signers, produces a synthetic signed artifact and evidence record, and satisfies only its linked task. Never call this a legally executed signature.

Email is local-only through Mailpit. Introduce link delivery in T06 and event-based messages/reminders in T18. Deduplicate by notification kind + recipient + triggering event/version. Persist send status and failures. SMTP delivery cannot be made transactionally exactly once with the database: retain stable message IDs, use provider idempotency where supported, and document the narrow retry ambiguity after SMTP acceptance. Links and application actions must remain replay-safe even if email is duplicated.

For bearer links, jobs carry a delivery-request reference, not the token. Generate the secret in the worker, commit only its hash and target before SMTP, and follow the shared request-consumption rules in [identity](03-domain-and-access.md#identity-and-invitations). An ambiguous delivery retry can issue a sibling token; consuming one invalidates all siblings. Protect the local inbox because it contains the delivered links even though application storage/logs do not.

Unfinished-application reminders default to 24 hours and 72 hours after last meaningful applicant activity, maximum two per inactivity episode, configurable with a fake clock for the demo. Before sending, re-check current activity, lifecycle, recipient verification/access, and suppression preferences. Stop after submission, withdrawal, decline, funding, or removal of the recipient. Do not repeatedly email an unverified address beyond its explicitly requested access message.
