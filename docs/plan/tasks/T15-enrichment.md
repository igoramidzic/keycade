# T15 — Industry, business, and tax simulations

Dependencies: T05, T08. Read [provider contracts](../04-integrations-and-jobs.md#provider-contracts).

## Outcome

Applicants can search industry suggestions, and authorized input changes produce delayed business/tax results without making identifiers mandatory at entry.

## Scope

- Add a small versioned NAICS fixture/search adapter and optional “I don't know” flow. Store code and taxonomy version when selected.
- Add provider contracts and delayed fake business-enrichment/tax adapters with success, no match, missing prerequisites, review, timeout, and failure scenarios.
- Add encrypted sensitive-identifier storage/service with masked responses and input revisions. Use local generated keys and synthetic values.
- Model tax authorization as an explicit prerequisite record; expose a protected service/API contract now and integrate its task UI with T12/T16.
- Store suggested enrichment facts separately from user-confirmed facts and show confirmation when suggestions are used.

## Acceptance criteria

- Industry can be searched by plain language and skipped without blocking intake; no-match never invents a code.
- Identifiers never appear in general responses, event payloads, queue payloads, or logs.
- A tax request without required identifier/authorization waits for input instead of claiming verification.
- Enrichment/tax results are visibly simulated, delayed, typed, and reviewable; user-entered confirmed values are not silently replaced.
- Updating an identifier while a request runs makes its previous result stale. Retry scenarios are deterministic.

## Validation

Test optional industry behavior, fixture versioning, encrypted round trips, masked DTOs, private access, missing authorization, stale inputs, and timeout/retry handling. Demonstrate search in intake and inspect queued results through the authorized API; T16 adds their full bank-workspace presentation.

No live tax/registry API, legal consent standard, or claim of real verification is included.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
