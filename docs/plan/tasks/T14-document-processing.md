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

Not started. Record date, commands/results, and deviations when implemented.
