# T13 — Private documents and upload on both dashboards

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

Not started. Record date, commands/results, and deviations when implemented.
