# T14 — Delayed ingestion, classification, and document groups

Dependencies: T05, T13. Read [integrations](../04-integrations-and-jobs.md).

## Outcome

Clean documents are processed asynchronously and organized into understandable groups with reviewable results.

## Scope

- Add the fake OCR/classification adapter with explicit content-fixture results, confidence, typed extracted fields, and simulated provenance.
- Trigger processing from a clean document version through the outbox; persist current and historical runs/results.
- Add grouped tabs for Tax documents, Bank statements, Financial statements, Business/legal, Identification, Signed documents, and Other.
- Show queued/processing/classified/needs-review/failed states, unknown content, retry actions, and staff category corrections.
- Suggest matching task evidence without completing requirements automatically. Store machine suggestions separately from confirmed values and manual category overrides.

## Acceptance criteria

- Tax and statement fixtures finish after configurable visible delay and appear in the correct authorized tabs.
- Unknown/low-confidence input remains accessible for review; interpretation failure preserves original clean bytes.
- Staff correction is audited and retains the original result. Reprocessing cannot silently erase a manual override.
- A stale result for a replaced document cannot become the current category/evidence result.
- Duplicate jobs cannot create duplicate documents/tasks. Suggested extracted financial facts do not overwrite confirmed application values.
- Classification never broadens access to private owner evidence; category labels/counts honor the same permissions as the underlying files.

## Validation

Test normal, unknown, low-confidence, timeout, transient-error, stale-version, and duplicate-event cases using fake time. Run one borrower upload and one staff upload through scanning, processing, grouped views, correction, and evidence review.

Defer real OCR/AI calls and financial spreading. Preserve schema-validation boundaries for a later live provider.

## Implementation record

Done — local interpretation, grouped document views, corrections and authorized transport workflows validated October 7, 2026. Live hosted deployment is not part of this acceptance record.

- Migration `0012_aromatic_logan.sql` adds version-bound processing generations, typed results, durable outbox entries and immutable category-override revisions. A clean scan and its processing intent commit atomically. Unscanned or blocked files never enter interpretation.
- The registered synthetic document bytes select deterministic tax, bank-statement, low-confidence, unknown, transient-error, terminal-error and timeout scenarios. The adapter uses configurable asynchronous delay, deadline and backoff with injected clocks. Results include confidence, typed suggested fields and explicit simulated provenance. Unknown/low-confidence input stays available for review; failure retains the original clean bytes.
- Processing claims use expiring leases and fenced claim tokens. Duplicate enqueue/dispatch is safe, a reclaimed lease rejects the old worker result, and replacement bytes invalidate the former version's current result while retaining its history. The local worker and native Worker adapter invoke the shared processing runtime.
- Both API transports expose authorized interpretation history/retry and staff category correction. Corrections retain the original machine result and an audit trail. A manual category survives reprocessing of the same version; replacement bytes require their own classification/correction.
- Shared dashboard tabs cover Tax documents, Bank statements, Financial statements, Business/legal, Identification, Signed documents and Other. Category counts, results and suggested task titles follow the underlying document/task permissions. Matching task evidence remains a suggestion: interpretation neither completes requirements nor copies extracted financial values into confirmed application facts.

### Validation

- **7 provider unit cases passed** for fake-clock delay/deadline behavior, known/unknown/low-confidence results, typed financial/year values, retry classification and rejection of unexpected provider fields.
- **11 new PostgreSQL pipeline cases passed** for clean-scan/outbox atomicity, rollback, duplicate jobs, quarantine, retry/backoff, manual corrections, stale replacements, timeout, expired/reclaimed leases and private document/task visibility. Transport tests in the document suite cover both Fastify and native Request/Response handlers.
- `pnpm test:e2e tests/e2e/document-processing.spec.ts`: **8/8 passed** on desktop/mobile in `.local/e2e-EetD1p`. Journeys cover borrower upload/grouped tabs and unverified suggestions, staff corrections/history, failed processing with retained download and retry, and restricted participant counts.
- Second-checkpoint aggregate: `pnpm check` passed formatting/lint, workspace typechecks and **256 unit tests in 18 suites**; `pnpm test:integration` passed **228 tests in 27 suites** against disposable PostgreSQL. API and worker deployment dry runs passed. Dry runs and local native-runtime tests do not establish hosted deployment acceptance.

### Try it locally

Run `pnpm db:migrate` and restart `pnpm dev`. Upload `packages/testing/fixtures/documents/clean-tax.pdf` or `clean-statement.pdf` from either workspace. After simulated scan/interpretation, inspect the relevant document tab and suggested fields. Staff can record a reasoned category correction and inspect the original result/history. `low-confidence.pdf`, `processing-error.pdf`, `processing-timeout.pdf` and `processing-transient.pdf` demonstrate review and failure/retry paths; registered content hashes select their outcomes, so renaming a file does not change its scenario.

Real OCR/AI, financial spreading and any claim of document authenticity remain deferred. Hosted R2 deployment verification is tracked in [the T13 follow-up](T13-document-upload.md#private-r2-adapter-follow-up--october-7-2026).

Final checkpoint: `pnpm check` passed all workspace/root typechecks and **256 unit tests in 18 files**; `pnpm build` passed all **12 workspace builds**. Existing Vite chunk-size advisories remain non-fatal. Additive migrations applied locally and development readiness confirms both PostgreSQL and the worker are available.
