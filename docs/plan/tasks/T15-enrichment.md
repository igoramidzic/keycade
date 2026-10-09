# T15 — Industry, business, and tax simulations

V2 amendment — October 8, 2026, **setup changes implemented locally in V2-01; V2-04 remains planned**: [V2-01](../v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) retains the versioned NAICS picker, displays its code/label in the industry question, setup review and business summary, and adds a narrowly authorized optional business-EIN command before setup completion. This supersedes later-only EIN capture for that command, without opening general identifier/enrichment APIs or collecting SSN in setup. New acceptance verifies encryption/masking, optional skip, bank/application restrictions and no implied tax authorization. [V2-04](../v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) owns separate reviewed financial facts.

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

Done — local industry search, private identifier storage and protected business/tax simulation APIs validated October 7, 2026. T16 owns private task-entry integration, identity/fraud checks and the full bank-workspace presentation. Hosted identifier/enrichment acceptance subsequently passed at checkpoint `5a3c1a5`; evidence below.

### Industry catalog and picker — October 7, 2026

- Replaced the temporary industry select with a shadcn/Base UI searchable popup. The complete Census 2022 U.S. six-digit catalog contains 1,012 entries. Local code/title/synonym/fuzzy search includes “dentistry office,” “dentstry ofice,” everyday descriptions and exact numeric codes. See [source evaluation, licensing, checksums and maintenance policy](../naics-source.md).
- Search text and selected value are separate. Only an explicit catalog selection saves a code plus `2022`; schema validation is shared with the backend. Paired null skip remains optional. Historical demo answers remain readable but require a valid selection or skip when edited.
- The popup preserves query/selection on failure, has a retry action, announces loading/results/no-match states, and ignores cancelled or out-of-order searches. The local index needs no provider credentials or external search requests.
- Validation: focused catalog/search and application-contract tests passed (30); `@keycade/contracts`, `@keycade/ui` and `@keycade/borrower` typechecks passed. `pnpm test:e2e tests/e2e/industry.spec.ts`: **4 passed**, desktop/mobile keyboard selection, persistence, Escape focus return, popup width, optional skip, failed-search retry and out-of-order response fencing; run `.local/e2e-MMQMvr` used disposable PostgreSQL. Additional direct domain validation is included in the setup integration suite.
- Catalog selection classifies the applicant's chosen industry; it makes no identifier, business or tax verification claim.

### Identifier and enrichment backend — October 7, 2026

- Migration `0013_melted_chronomancer.sql` adds immutable encrypted identifier versions, scoped input revisions and tax authorization, durable enrichment runs, and separately confirmed facts. Composite foreign keys prevent linking another application's identifier or result. `ENCRYPTION_KEY` is the generated local 256-bit key; AES-256-GCM uses a random nonce and authenticates bank, application, subject and identifier revision.
- The protected service exposes a mask, presence and revision only. Business EIN scope requires full applicant-administrator or bank staff access. Personal SSN scope requires the subject's active applicant/owner participation, or staff access in the same bank. Other applicant administrators, advisers, revoked users, strangers, and other banks cannot read the personal view. Applicant setup completion remains required.
- Requests persist their job intent in the same transaction as input changes. Run rows support bounded attempts, delayed retry, claim expiry/recovery, history and duplicate-safe application. Input changes invalidate prior results; replacing an identifier also clears tax authorization. Previously requested operations are rescheduled once for the new input revision, and missing identifier/authorization remains `waiting_for_input`. Authorization and input versions are checked before the provider call and before applying its result.
- Only registered, invalid-for-real-world identifiers `000000001`–`000000007` are accepted: success, no match, needs review, transient error, timeout, terminal error and missing input respectively. There is no public scenario parameter. Adapters have configurable asynchronous delays and injected clocks, strict typed simulated results, and no network provider calls. Business suggestions and sample tax availability make no verification claim.
- Fact confirmation is explicit, revision-checked and audited. It records the selected suggestion separately, preserves provider history and never overwrites application business facts. Old confirmations become visibly stale after input changes. Staff retries accept an allowlisted reason, preserving a safe reason in audit metadata without free-text identifier leakage.
- Validation: **14 focused unit tests passed** for authenticated encryption, scope/revision/key tampering, randomized ciphertext, synthetic-only inputs, explicit notice/retry contracts, delayed business/tax results, no match/review/missing-input outcomes, deadlines and strict provider result boundaries. **7 real-PostgreSQL integration tests passed** for masked storage and history, private/cross-bank access, setup and tax prerequisites, duplicate claims, stale input during execution, explicit confirmations, retry exhaustion and recovery, revoked authorizers, and database scope/null-consent constraints.

### Transport, runtime and checkpoint validation

- **4 protected HTTP tests passed** across Fastify and native Workers transports, exercising the shared identifier, authorization, request, confirmation and retry contracts with synthetic data. The local worker receives the generated encryption key and processes durable enrichment intent with configured delays.
- Second-checkpoint aggregate: `pnpm check` passed formatting/lint, workspace typechecks and **256 unit tests in 18 suites**; `pnpm test:integration` passed **228 tests in 27 suites**. The earlier worker dependency-resolution failure was repaired before the successful full run. API and worker deployment dry runs passed.
- At the second checkpoint, the hosted environment had no enrichment encryption key and no deployed identifier/enrichment acceptance had run. D03 subsequently installed the shared private key; the hosted acceptance below verifies the deployed path rather than inferring it from the earlier native transport tests.
- Protected API operations are under an application's `/enrichment` route: read the safe view, save a registered synthetic identifier, explicitly authorize sample tax availability, request a business/tax run, and explicitly confirm a current suggested fact. Staff can retry permitted terminal requests with an allowlisted reason. T16 adds the corresponding private tasks and staff readiness presentation; it must lock material identifier/authorization changes against submitted or decided snapshots together with T19's lifecycle policy.

### Intake feedback — October 7, 2026

The user requested a searchable, fuzzy-matching NAICS combobox rather than the current short industry dropdown. “NEX code” refers to the industry-classification search already described in the product plan. This expands T15's original small-fixture requirement to a versioned catalog with hundreds of entries and source evaluation. Implementation stays deferred to T15; T08's optional fixture remains usable in the meantime. Dependencies remain T05 and T08.

Final checkpoint: `pnpm check` passed all workspace/root typechecks and **256 unit tests in 18 files**; `pnpm build` passed all **12 workspace builds**. Existing Vite chunk-size advisories remain non-fatal. Additive migrations applied locally and development readiness confirms both PostgreSQL and the worker are available.

### Hosted identifier and enrichment acceptance — October 7, 2026

At deployed checkpoint `5a3c1a5`, all five native Cloudflare builds and [Neon migration run 37676993377](https://github.com/igoramidzic/keycade/actions/runs/37676993377) passed. The focused `tests/e2e/hosted-enrichment.spec.ts` case passed against the actual borrower URL in 1.0 minute:

- Signed in as a new fictional `example.test` demo identity and created/completed setup for only its new synthetic application, `eeb09326-349f-4f26-b22d-2017e199c56b`.
- Requested sample tax availability before inputs and observed `waiting_for_input` for identifier and tax authorization.
- Saved registered invalid-for-real-world identifier `000000001`; the response exposed only `**-***0001`. Explicitly authorized the `demo-tax-v1` notice, then requested business simulation.
- Observed both current runs succeed through the hosted worker. Shared strict contracts parsed the simulated result, two business suggestions and one sample tax-availability record. No suggested fact was confirmed automatically; business name, amount, purpose and application revision remained unchanged.

Report: `.local/hosted-enrichment-5a3c1a5/report.json`. No external registry/tax provider, real identifier, authentication trace or bearer artifact was used. Existing hosted applications were untouched. This narrow acceptance complements the local privacy/staleness/failure suites; it does not claim those negative cases all ran against the shared hosted demo.

```sh
KEYCADE_E2E_HOSTED=true DEMO_INBOX_ENABLED=true \
KEYCADE_E2E_BORROWER_ORIGIN=https://keycade-borrower.kualia.workers.dev \
KEYCADE_E2E_STAFF_ORIGIN=https://keycade-bank-console.kualia.workers.dev \
pnpm exec playwright test tests/e2e/hosted-enrichment.spec.ts --config=playwright.hosted.config.ts
```
