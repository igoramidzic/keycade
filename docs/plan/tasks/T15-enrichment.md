# T15 — Industry, business, and tax simulations

Dependencies: T05, T08. Read [provider contracts](../04-integrations-and-jobs.md#provider-contracts).

## Outcome

Applicants can search industry suggestions, and authorized input changes produce delayed business/tax results without making identifiers mandatory at entry.

## Scope

- Replace T08's small industry select with a searchable combobox: type and filter inside the open picker, using the interaction pattern of a Spartan combobox while retaining the repository's React/shadcn stack and default styling.
- Provide hundreds of valid, versioned NAICS entries, preferably the complete chosen taxonomy, with code and human-readable title. Search by code, title, everyday business descriptions, synonyms, and tolerant fuzzy matching (for example, “dentistry office” should surface the relevant dental-office classification). Never require users to know a code.
- Evaluate an authoritative downloadable NAICS dataset and third-party search/data services during T15. Record coverage, taxonomy version, licensing, update policy, and availability before choosing a source. Prefer a local versioned index for deterministic demo search; keep any provider credentials and adapters on the server. A hosted provider is optional, not a new dependency for T08.
- Keep an optional Skip/“I don't know” flow. Save only an explicitly selected valid code and its taxonomy version; typed search text or a fuzzy suggestion must not silently become the chosen industry.
- Add provider contracts and delayed fake business-enrichment/tax adapters with success, no match, missing prerequisites, review, timeout, and failure scenarios.
- Add encrypted sensitive-identifier storage/service with masked responses and input revisions. Use local generated keys and synthetic values.
- Model tax authorization as an explicit prerequisite record; expose a protected service/API contract now and integrate its task UI with T12/T16.
- Store suggested enrichment facts separately from user-confirmed facts and show confirmation when suggestions are used.

## Acceptance criteria

- The combobox searches and filters a catalog of hundreds of valid entries inside its dropdown by code or plain language. “Dentistry office,” related synonyms, and minor misspellings find a relevant entry; selecting it persists its code and taxonomy version.
- Keyboard users can open the picker, type, navigate results with arrows, select with Enter, and dismiss with Escape. Results and selection are screen-reader accessible and fit mobile widths. Loading, empty/no-match, and retryable error states preserve the query.
- Industry remains optional and can be skipped without blocking intake. No-match never invents a code; stale asynchronous responses cannot replace newer search results or change the selected value.
- Identifiers never appear in general responses, event payloads, queue payloads, or logs.
- A tax request without required identifier/authorization waits for input instead of claiming verification.
- Enrichment/tax results are visibly simulated, delayed, typed, and reviewable; user-entered confirmed values are not silently replaced.
- Updating an identifier while a request runs makes its previous result stale. Retry scenarios are deterministic.

## Validation

Test catalog breadth, exact-code lookup, synonyms/fuzzy ranking, “dentistry office” retrieval, no-match, keyboard/mobile combobox behavior, out-of-order search responses, optional industry behavior, fixture versioning, encrypted round trips, masked DTOs, private access, missing authorization, stale inputs, and timeout/retry handling. Demonstrate search in intake and inspect queued results through the authorized API; T16 adds their full bank-workspace presentation.

No live tax/registry API, legal consent standard, or claim of real verification is included.

## Implementation record

In progress — industry catalog/search slice implemented October 7, 2026. Business/tax simulations, encrypted identifiers, tax authorization and enrichment fact confirmation remain unfinished.

### Industry catalog and picker — October 7, 2026

- Replaced the temporary industry select with a shadcn/Base UI searchable popup. The complete Census 2022 U.S. six-digit catalog contains 1,012 entries. Local code/title/synonym/fuzzy search includes “dentistry office,” “dentstry ofice,” everyday descriptions and exact numeric codes. See [source evaluation, licensing, checksums and maintenance policy](../naics-source.md).
- Search text and selected value are separate. Only an explicit catalog selection saves a code plus `2022`; schema validation is shared with the backend. Paired null skip remains optional. Historical demo answers remain readable but require a valid selection or skip when edited.
- The popup preserves query/selection on failure, has a retry action, announces loading/results/no-match states, and ignores cancelled or out-of-order searches. The local index needs no provider credentials or external search requests.
- Validation: focused catalog/search and application-contract tests passed (30); `@keycade/contracts`, `@keycade/ui` and `@keycade/borrower` typechecks passed. `pnpm test:e2e tests/e2e/industry.spec.ts`: **4 passed**, desktop/mobile keyboard selection, persistence, Escape focus return, popup width, optional skip, failed-search retry and out-of-order response fencing; run `.local/e2e-MMQMvr` used disposable PostgreSQL. Additional direct domain validation is included in the setup integration suite.
- No identifier or business/tax verification claims are introduced. T15 remains in progress until its remaining backend and simulation acceptance criteria pass.

### Intake feedback — October 7, 2026

The user requested a searchable, fuzzy-matching NAICS combobox rather than the current short industry dropdown. “NEX code” refers to the industry-classification search already described in the product plan. This expands T15's original small-fixture requirement to a versioned catalog with hundreds of entries and source evaluation. Implementation stays deferred to T15; T08's optional fixture remains usable in the meantime. Dependencies remain T05 and T08.
