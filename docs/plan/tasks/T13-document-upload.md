# T13 — Private documents and upload on both dashboards

V2 amendment — October 8, 2026, **not implemented**: [V2-02](../v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) adds actual borrower-sidebar upload; [V2-03](../v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) adds demo-panel text-to-PDF generation; [V2-04](../v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) adds the private split preview. Ordinary supported types/limits, quarantine, immutable versions and access guards remain. Each new task adds its own byte-path, denial and browser acceptance; `.txt` is not a general document-upload type.

Dependencies: T12. Read [document pipeline](../04-integrations-and-jobs.md#document-pipeline).

## Outcome

Authorized users upload and retrieve evidence safely from either application workspace.

## Scope

- Add document/version/storage metadata, checksums, task-evidence links, and a private local storage adapter.
- Wire T11’s document scope policy to persisted document visibility and subject ownership. Validate delegated document IDs against the same bank/application and current inviter permissions before allowing nonempty document grants.
- Add streaming uploads with allowlisted MIME/content checks, configurable size/batch limits, safe filenames, and immutable versions.
- Build a shared drop area/file picker, per-file progress, cancellation/retry UI, and authorized file list/download routes.
- Add a delayed simulated scan adapter: pending → clean/blocked/error. Quarantine files until clean; processing/download permissions do not depend on uploader-chosen filenames.
- Stage bytes and metadata with cleanup/reconciliation for abandoned uploads and crashes; avoid records claiming a usable file when bytes are missing.

## Acceptance criteria

- Borrower, assigned adviser, and staff upload from their permitted dashboard/task scope; all requests re-check access.
- PDF/JPEG/PNG defaults, 25 MiB/file and 10-file batches are enforced server-side and configurable.
- Cross-bank/application/task attachments, unsupported/spoofed content, oversized files, and path traversal are rejected safely.
- Unscanned/blocked content cannot be downloaded normally or sent to OCR. Unknown scan failures remain visible for retry.
- Partial batch failure preserves successful uploads and reports individual errors. A replacement creates a new version and reopens affected evidence review as specified.
- Revoked users lose API-mediated downloads immediately; private files have no permanent public URL.

## Validation

Test real upload/download authorization, corrupt/spoofed/oversized payloads, interrupted upload cleanup, missing bytes, duplicate retries, and scan outcomes. Demonstrate drag-and-drop and keyboard file picking on both dashboards.

Use only synthetic documents; the simulated scan is not a production malware scanner. OCR and category tabs arrive in T14.

## Implementation record

Done — local upload milestone validated October 7, 2026. The private R2 adapter has since passed local runtime checks; hosted deployment remains unverified, as described below.

- Added scoped document records, immutable versions, SHA-256 digests, staged upload reservations and task-version evidence links with migration `0011_polite_wolverine.sql`. Task visibility and private subject ownership come from current server records. Explicit document grants are validated against the application, inviter and recipient; revocation is checked on every API download.
- Both API transports expose bounded batch reservations, streamed byte upload, cancellation, clean-only downloads and scan retry. Local bytes use an opaque UUID, a private directory and atomic, non-overwriting file publication. Interrupted streams remove temporary files; the worker reconciles expired reservations and old staging files. Missing bytes fail closed and reopen current evidence review.
- The shared dashboard drop area supports keyboard file selection, per-file progress, cancellation, retry and partial failures. Documents are available in the application Documents section and inline task details. Replacement uploads retain history and reopen review; saving a file never completes a requirement.
- PDF/JPEG/PNG content signatures and framing are checked. Defaults are 25 MiB and 10 files, configurable through `DOCUMENT_MAX_FILE_BYTES` and `DOCUMENT_MAX_BATCH_FILES`. These format checks and the explicitly simulated scanner are not a production parser or malware scanner.
- Registered content hashes drive benign synthetic scan scenarios. Ordinary supported content receives a simulated clean result; `blocked.pdf`, `scan-error.pdf` and `scan-transient.pdf` demonstrate quarantine and retries. Names never choose outcomes. File fixtures are in `packages/testing/fixtures/documents/`.
- Durable scan intent is stored transactionally on the uploaded version; the local worker claims it with a lease and generation token. This database-backed queue needs no raw file content in job payloads. T14 adds interpretation work after clean scans.
- Hosted transport routes share the same domain and streaming contracts and are tested through the native Request/Response handler. At the first checkpoint the deployed Worker had no private R2 binding. The follow-up below adds the adapter, private bucket and deployment configuration, while local storage remains the demonstrated end-to-end target until hosted deployment is verified.

### Validation

- New domain tests cover same-bank/application/task isolation, assigned advisers, owner privacy, delegated document scope, session revocation, immutable retries/replacements, stale finalization, task clean-scan gates, missing metadata and abandoned cleanup against real PostgreSQL.
- New HTTP tests exercise both Fastify and Workers handlers: byte upload/download, CSRF, cross-bank denial, missing bytes, size/batch limits, spoofing, cancellation, blocked scans and retryable scan errors.
- Storage tests exercise bounded streaming, checksums, private modes, concurrent duplicate writes, immutable content, incomplete/oversized/spoofed/interrupted files, traversal and injected scan timing.
- Browser tests demonstrate drag/drop, keyboard picking, downloads, replacements, partial failure, lost-acknowledgement retry, cancellation, task evidence, permission errors and scan states on desktop/mobile.
- Checkpoint commands: `pnpm check` passed lint, all 12 workspace typechecks and **231 unit tests**; `pnpm build` passed all 12 packages; `pnpm test:integration` passed **204 tests** in 24 real-PostgreSQL suites. Document/updated-navigation browser run passed **16/16** across desktop/mobile (`.local/e2e-uzkXYl/summary.json`); industry browser run passed **4/4** (`.local/e2e-MMQMvr/summary.json`). Builds retain non-blocking client bundle-size warnings.

### Try it locally

Run `pnpm db:migrate`, then restart `pnpm dev`. Sign in to either dashboard with a synthetic seeded identity, open an application, then Documents (or expand a task's Files section). Upload `packages/testing/fixtures/documents/clean-tax.pdf`. Scanning is delayed by `SIMULATION_DELAY_MS`; the file becomes downloadable after a clean result. No file has a permanent public URL.

### Private R2 adapter follow-up — October 7, 2026

- Added a private R2 storage adapter and `DOCUMENTS` bucket bindings in the API/jobs deployment configuration. The `keycade-private-documents` bucket was created, and its managed public URL is disabled (`enabled: false`). Downloads continue through authorized API routes.
- The adapter and native worker path passed local `workerd` testing. API and jobs worker deployment dry runs passed. The jobs runtime can scan R2-backed bytes and invoke the shared T14 interpretation pipeline.
- No deployment or real hosted upload/download acceptance was completed in this checkpoint. A created private bucket, checked-in bindings and local runtime tests do not prove the deployed workers have picked up those bindings or that the hosted byte path works. Preserve this distinction until a synthetic upload, scan, interpretation and authorized download are demonstrated against the deployed environment.

The R2 review additionally reproduced a stalled upstream request after midstream storage failure. The adapter now cancels the upstream reader and writer, preserves the original failure, and always reaches staging cleanup. Four targeted cancellation/early-exit/first-error regressions and three existing local storage tests pass; API, jobs and integration workspace types pass.
