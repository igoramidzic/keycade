# V2 delivery and validation

Planning date: October 8, 2026. V2-01–V2-07 are complete locally. V2-08 is **Done — hosted acceptance**. Only the task-specific evidence below proves v2 behavior.

Read [the experience specification](02-experience-spec.md) and [the data and simulation specification](03-data-and-simulation.md) before implementing a task. The [main plan](../README.md), [architecture](../02-architecture.md), [access rules](../03-domain-and-access.md), and [verification discipline](../05-development-and-testing.md) still apply. Implement one bounded task or reviewable slice at a time.

## Sequence

| ID | Deliverable | V2 dependencies | Existing prerequisites | Status |
| --- | --- | --- | --- | --- |
| V2-01 | Expanded resumable intake | — | T07, T08, T15 | Done — local acceptance below |
| V2-02 | Borrower task dashboard without top tabs | V2-01 | T09, T11–T13, T17–T21, D05 | Done — local acceptance below |
| V2-03 | Protected text-to-fixture demo importer | — | T13, T14, D05 | Done — local acceptance below |
| V2-04 | Document review and confirmed financial facts | V2-01, V2-03 | T14, T15, T19 | Done — local acceptance |
| V2-05 | Lender application overview and evidence drill-down | V2-01, V2-04 | T10, T12, T16, T19, T21 | Done — local acceptance |
| V2-06 | Simulated Loan Footprint | V2-01 | T16 | Done — local acceptance |
| V2-07 | Integrated local acceptance | V2-02, V2-03, V2-04, V2-05, V2-06 | T22 | Done — local acceptance |
| V2-08 | Hosted parity and deployment acceptance | V2-07 | D02, D03 | Done — hosted acceptance |

Existing prerequisites are complete in the main plan. V2-08 carries the combined v2 implementation and earlier local-only follow-ups through native deployment and the hosted acceptance slice below. All eight v2 tasks are complete. Loan Footprint is available through the completed Overview and existing Checks view.

## Shared completion rules

- Preserve the TypeScript/pnpm/Turborepo/React/Node/PostgreSQL/Drizzle architecture and default shadcn styling. Use the required shadcn CLI for new components. Do not change the stack to mimic the reference product.
- Keep the local Fastify and native Workers HTTP transports aligned. Shared domain authorization owns bank, application, participant, task and document scope; browser visibility is never authorization.
- All external behavior remains simulated, including hosted production. Use synthetic data, configured asynchronous delays and injected clocks; no real OCR/AI, geocoding, tax, identity, email, signature or financial provider is required.
- Persist changes, audit and job intent transactionally. Enforce revisions, idempotency, current-input checks and lifecycle guards. Add committed Drizzle migrations whenever persistent structure changes, and test both clean creation and upgrade preservation against real PostgreSQL.
- Each task adds meaningful tests for its behavior as it is built. Record exact commands, outcomes, screenshots/report locations and limitations below; do not defer critical negative or isolation tests to V2-07.
- Run relevant unit, PostgreSQL and both-transport HTTP tests, then affected browser cases and repository checks. Current root commands include `pnpm check`, `pnpm build`, `pnpm test:integration`, and `pnpm test:e2e`; verify the command inventory at implementation time. Read installed Turbo documentation before changing Turbo configuration or commands.
- Browser validation includes desktop, mobile, keyboard and recoverable error states. The fixed D05 scenario panel must reserve layout space; dialogs, uploads and application actions must remain usable without overlap or horizontal overflow.
- Record local completion separately from hosted deployment. Native Worker tests and dry runs do not prove actual hosted behavior. Update the main index and requirement map only to the level evidenced.

## V2-01 — Setup contracts, migration and wizard

Dependencies: T07, T08, T15. Primary areas: setup contracts/domain, Drizzle migrations, borrower wizard, staff prefill and safe DTOs.

### Scope

- Extend the versioned setup definition with required business legal name and structured business address, optional business taxpayer identification number (EIN), optional website, existing optional NAICS selection, and illustrated multi-select funding purposes.
- Retain email-first access, one simple question per screen, server-saved Back/Continue/Skip progress, review/correction and explicit completion. Present the selected NAICS code and title in its dedicated question, setup review and business details; keep the website question focused on its own answer. Accept and normalize bare website domains to HTTPS; it is a classification code, not a numeric score.
- Add stable purpose codes and a versioned catalog. Preserve historical raw purpose text; do not infer new selected categories from ambiguous old prose. Retain the fixed Synthetic Business Credit product and amount validation.
- Route optional EIN through the existing encrypted identifier service using a narrow, authenticated pre-setup business-EIN command. Authorize only the full applicant administrator for that application and same-bank staff. Do not relax the general setup gate or personal-identifier access, store EIN in setup JSON, or imply tax authorization.
- Preserve completed legacy applications and historical decisions. Migrate unfinished setup to the new definition without losing acknowledged answers; collect newly required missing fields before completion. Synchronize staff prefill and resume labels with the new definition.

### Acceptance and tests

1. A new applicant saves legal name/address, skips EIN/website/NAICS, selects multiple illustrated purposes, resumes on a new browser and completes setup. Selection is keyboard accessible and review reflects acknowledged answers only.
2. Address and purpose validation run in domain/contracts and both HTTP transports. Invalid input, network failure and stale revisions preserve recoverable edits; direct portal calls remain denied before completion.
3. Real-PostgreSQL upgrade cases cover unfinished drafts at every old step, staff-prefilled drafts, completed applications and legacy raw purposes. Re-running migrations/seeds is safe; no completed application is re-gated or silently rewritten.
4. Synthetic EIN is encrypted, masked and absent from general setup DTOs, audit payloads, queues, logs and browser persistence. Test cross-bank/other-application/restricted/revoked denial and concurrent revision conflicts; personal SSN and tax-authorization operations retain their existing prerequisites.
5. Desktop/mobile browser journeys verify one-question screens, optional skip, purpose image labels, existing NAICS search, explicit finish, fixed product and failed-save recovery.

Implementation record: **Done — local acceptance, October 8, 2026.**

- Definition 2 adds structured address, optional normalized website, secure optional EIN, existing NAICS, ordered purpose IDs/catalog and optional Other detail. Screens retain Back, explicit Skip/Clear, Continue later, saved resume, recoverable failures and explicit idempotent completion. Purpose cards use meaningful icons and native checkbox semantics.
- Migration `0021_volatile_wong.sql` upgrades unfinished v1 setups without erasing answers or legacy raw purposes, increments stale-write revisions, and leaves completed setup definitions/times unchanged. Both runtime readiness checks include the new columns. Staff can prefill expanded non-sensitive fields, with email-only creation and retry deduplication preserved; applicant acknowledgment is required.
- Both HTTP transports implement a dedicated revision-checked encrypted setup-EIN command. Mask-only DTOs, staff/applicant distinction, explicit replacement/clear, version history, denial paths, concurrent conflicts and transaction rollback are covered. Personal identifiers and tax authorization remain gated; no provider work starts from setup EIN entry.
- Existing portal and staff summaries display canonical selected purposes. New submission snapshots retain address/revision, website and ordered purposes with immutable history and legacy-read compatibility. The broader borrower dashboard and lender overview changes remain V2-02/V2-05.
- Independent review closed the older generic business-identifier write route for unfinished setups, preventing staff from bypassing the revision/acknowledgment contract. Solely-staff changes clear applicant acknowledgment; exact current applicant grants remain authoritative. Removing Other during its saved conditional question routes back to purpose confirmation.

Validation record — working tree based on `e11febd`, October 8, 2026:

- Full unit suite: **305 passed across 29 files** using `node_modules/node/bin/node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts'`. All **12 workspace typechecks and builds**, root TypeScript, Biome and browser package-boundary checks passed. The host pnpm launcher could not verify its package-manager registry signature in this environment; the installed Node 24.21.0 and repository binaries ran the corresponding scripts directly, without dependency/lockfile changes.
- Final real-PostgreSQL suite: **393 passed across 40 files**, using the same owned-local-target checks and private in-memory `TEST_DATABASE_URL` configuration as `pnpm test:integration`, then the installed Vitest `run .integration.test.ts`. Covers fresh/upgrade migrations, every legacy setup step, seed repeat, completed legacy preservation, both HTTP transports, permissions/revocations, versions, stale writes, concurrent EIN commands, encryption failure rollback, safe audit, and immutable submission/decision facts. New snapshot fields preserve legacy fingerprints when all new facts are absent; old JSON and decisions are never rewritten.
- Borrower core intake/NAICS: **16/16 desktop/mobile**, report `.local/e2e-rizwKE`; final purpose-clear and website/industry recovery regressions **6/6**, `.local/e2e-JM0rUT`. Separate-application draft isolation **2/2**, `.local/e2e-LiY03r`; opt-in simulated-inbox resume **2/2**, `.local/e2e-IkhnA4`. Runs used `node_modules/node/bin/node --import tsx scripts/e2e.ts` with the selected specs/grep; inbox run sets `DEMO_INBOX_ENABLED=true`. Keyboard selection, optional skip/clear, lost responses, session changes, explicit finish and desktop/mobile overflow/layout were checked. Safe purpose/review screenshots were visually inspected.
- Staff creation/prefill/handoff: **16/16 desktop/mobile browser tests passed**, including email-only lost-response recovery, exact saved prefills and borrower confirmation. Report: `.local/e2e-2CEO9a`; fictional overview/queue screenshots were visually inspected.
- `git diff --check` and all **255 local Markdown link targets** passed. Local migration apply and repeat no-op succeeded. Existing local API/frontend readiness reports database and worker ready after restarting the development worker watcher. No data reset or hosted deployment was performed.

Try locally: open `http://127.0.0.1:3001/apply?bank=bank-a`, use a new fictional `example.test` email, enter a synthetic address with explicit country code, skip optional EIN/industry/website or use registered EIN `000000001`, then choose multiple purposes. Use Continue later and sign in again with the same email; Finish setup opens the existing portal. Staff creation remains available at `http://127.0.0.1:3002` with `officer-a@example.test`.

## V2-02 — Borrower task dashboard

Dependencies: V2-01; T09, T11–T13, T17–T21, D05. Primary areas: borrower application workspace, tasks and contextual navigation.

### Scope

- Replace the borrower's top application-section navigation with a task-first landing page: outstanding/completed work on the left, application progress and authorized upload on the right. Stack these regions coherently on mobile.
- Provide contextual actions for documents, assigned people, signatures, application review/submission, closing/account summary and activity where applicable. Retain useful deep links and return-to-dashboard behavior.
- Keep actual application stage separate from required-task completion and setup progress. Use existing server permissions for summaries/counts and upload destinations; scoped collaborators see only permitted work.
- Preserve lender-only invitations, borrower business/application selection, closed/funded behavior and setup redirects. Keep the scenario kit available without obscuring either dashboard column.

### Acceptance and tests

1. No lender-style top application tabs appear on borrower desktop or mobile. Task, progress and upload regions are visible and usable with empty, waiting, failed and completed work.
2. Existing signature, review, closing, activity and document journeys remain reachable through contextual actions and supported deep links; browser Back and return-to-dashboard preserve application context.
3. Restricted and revoked participants cannot infer private tasks/documents from cards, counters or progress, or upload through a generic right-rail target. Verify backend denial and clear sensitive cached content on access loss.
4. Desktop/mobile keyboard journeys cover uploads, focus order, long task lists, reopening a task, active application switching, incomplete setup and scenario-kit expansion without overlap.

Implementation record: **Done — local acceptance, October 8, 2026.**

- Replaced borrower application tabs with a task dashboard, scoped personal/assigned/business groups (including completed assignments), actionable state labels, current-stage timeline and sidebar general uploads. Mobile shows a compact application summary above tasks, then the same progress/upload/contact regions below.
- Contextual documents, signing, review/submission, closing/account, people and activity routes retain their old URLs. Returning or using browser Back preserves the mounted task editor and its unsaved values; completed terminal applications retain inspectable tasks/history with an explicit closed outcome.
- Timeline events project persisted setup completion, review events and closing commands in revision order. Loan Booked requires the existing funded-account link. The officer contact is the actual assigned active synthetic staff member, or a safe unassigned state. Withdrawals retain any previously reached approval/closing milestone without implying future completion. No new mutable workflow stage or schema migration is introduced.
- Sidebar uploads use current backend general-upload permission, private reservation/byte/scan/processing APIs and stable retry keys. They never link evidence to a task automatically. Assigned collaborators retain their task-specific destinations. The demo kit registers only visible upload targets, prioritizes an expanded task over the general uploader and restores the previous target after navigation.
- Read or mutation access denial removes application/list/account caches and unmounts retained editors; identity/application changes create independent queues and editors. Private findings, hidden counts, raw identifiers and loan-account details remain backend restricted.

Validation record — working tree based on `f46aa06`, October 8, 2026:

- Final `pnpm check` and `pnpm build` passed: Biome/boundaries, all 12 workspace typechecks/builds and **320 unit tests**. After the final denial-latch adjustment, borrower typecheck/build and repository Biome passed again.
- Full real-PostgreSQL integration passed: **396 tests across 41 files**, including repeated timeline ordering, cross-bank/direct-ID denial, restricted counts/terms, revoked contact/membership, linked funding and both HTTP transports. A second full `pnpm test:integration` run passed after the assignment projection change, using the installed Node 24 runtime. No runner source changed.
- **96 distinct desktop/mobile browser cases verified across coordinated runs**, not one clean 96-case invocation. The main 76-case selection initially passed 70; focused reruns repaired all six failures. Fourteen document-processing/task-conflict cases, four dashboard safety cases and two actual sidebar-drop cases complete the 96-case coverage. All runners stopped and removed their disposable databases.
- Browser evidence: main `.local/e2e-dJfRT3`; focused desktop `.local/e2e-SsGSt0` (4/5 initially, final signing repaired separately); collaborators `.local/e2e-MrKTlG` (2/2); final signing `.local/e2e-hJ8ODU` (2/2); documents/conflicts `.local/e2e-cUxYUE` (12/14 initially) plus label correction `.local/e2e-Emddv6` (2/2); safety `.local/e2e-kEd6PK` (4/4); sidebar drop `.local/e2e-rxeiAj` (2/2).
- Verified no application tabs, compact mobile summary, long lists, task switching/reopening, setup/application selection, keyboard/file-picker and actual file-drop uploads, ambiguous-response retry without duplicate versions, scan/processing retry, unchanged task evidence after general upload, contextual routes and Back, unsaved edits, terminal history, full approval/signing/closing/funding, restricted general-upload denial and same-session revocation. Safety cases retain a denied workspace through 30 seconds of polling and require explicit fresh-data retry; hidden tasks cannot remain demo upload targets. Desktop/mobile screenshots were visually inspected, with no horizontal overflow or demo-kit overlap.
- Initial checks caught a denial-latch remount bug, retained-editor task deep-link handling and demo-target restoration, all corrected and reverified. Browser fixtures now wait for actual response/control readiness, pace multi-actor journeys and park inactive test pages; application timeouts and rate limits are unchanged. Assertions were updated for contextual closed banners and borrower action labels.

Browser commands used (Node 24 was selected with `PATH="$PWD/node_modules/.bin:$PATH"`):

```sh
pnpm test:e2e tests/e2e/borrower-dashboard-v2.spec.ts tests/e2e/borrower-workspace.spec.ts tests/e2e/tasks.spec.ts tests/e2e/documents.spec.ts tests/e2e/collaborator-upload.spec.ts tests/e2e/review.spec.ts tests/e2e/closing.spec.ts tests/e2e/request-efficiency.spec.ts tests/e2e/demo-scenarios.spec.ts tests/e2e/signatures.spec.ts tests/e2e/activity-operations.spec.ts
pnpm test:e2e tests/e2e/closing.spec.ts tests/e2e/review.spec.ts tests/e2e/signatures.spec.ts tests/e2e/borrower-workspace.spec.ts tests/e2e/tasks.spec.ts --project=desktop --grep "approved terms progress|staff-on-behalf submission|two intended signers|portal polling|application dashboard keeps tasks"
pnpm test:e2e tests/e2e/collaborator-upload.spec.ts
pnpm test:e2e tests/e2e/signatures.spec.ts --grep "two intended signers"
pnpm test:e2e tests/e2e/document-processing.spec.ts tests/e2e/task-conflicts.spec.ts
pnpm test:e2e tests/e2e/document-processing.spec.ts --grep "borrower tax uploads"
pnpm test:e2e tests/e2e/borrower-dashboard-safety.spec.ts
pnpm test:e2e tests/e2e/borrower-sidebar-drop.spec.ts
```

Local scope only. At the V2-02 checkpoint, V2-03–V2-08 remained unstarted; no deployment or hosted parity was claimed. The current task index supersedes that historical status.

### Shorter task cards — October 8, 2026

Follow-up status: **Done — local acceptance.** The user found expanded borrower tasks long and wordy, questioned the per-task document section beside the sidebar uploader and asked that finished tasks keep their place.

- The task list sits directly on the page canvas: its title, progress and filter are no longer wrapped in an outer card, and each task row is the only card surface. Staff assignment and review forms inside an expanded task are divider-separated sections rather than nested boxes. This restores the intended no-nested-cards layout, which no committed version of the redesign carried.
- Rows keep stage order (submission, approval, closing), then the server's creation order, for borrowers and staff. Saving, submitting, review or completion never moves a row.
- An answer task shows its stored question as the field label, then Save/Submit. Readiness confirmations ask “Are you ready to provide this information?” and keep their stored instructions in Details. The reason, requirement source, required/optional, assignee, owner-private flag, fictional-data reminder and answer/review history share one collapsed **Details and history** section. A **Changes requested** note appears above the field only while the task is returned. The separate disclaimer, due line (still in the row summary) and bordered answer box are gone.
- The borrower dashboard drops the in-task uploader from shared business tasks, since the sidebar already accepts business files and the Documents page can still attach a file to a specific task. Private owner tasks, assigned-only tasks and collaborators without general upload permission keep the in-task uploader so personal or restricted evidence never goes through the general target. Staff task documents are unchanged. No backend grant, schema or stored requirement text changed.

Validation at `00065d7` on `main`, October 8, 2026 (Node 24.21.0; local PostgreSQL 16 and Mailpit because Podman is unavailable in this sandbox; a gitignored copy of `scripts/e2e.ts` skipped only the Podman container-ownership check and pointed Playwright at the preinstalled Chromium):

- `pnpm typecheck` passed all 12 workspaces and root TypeScript; `pnpm test` passed **419 unit tests**; `scripts/boundaries.ts` passed. Biome reports one pre-existing formatting error in `packages/ui/src/components/animated-collapse.tsx`, outside this change.
- **72 distinct desktop/mobile browser cases verified.** `tasks.spec.ts` and `borrower-dashboard-v2.spec.ts` passed 18/18 (`.local/e2e-T1IkhY`). Documents, dashboard safety, checks, closing, document processing, participants, review, signatures, task conflicts, collaborator upload and sidebar drop passed 53/54 (`.local/e2e-nZBNej`). The failing desktop `checks.spec.ts` case hit a strict-mode match on two owner identifier tasks, because the dashboard-safety spec earlier in the same run adds a synthetic owner to the same seeded application; `checks.spec.ts` alone passed 2/2 (`.local/e2e-qO4p0B`).
- Updated assertions: the answer field is located by its `task-answer-` id instead of the removed “Your answer” label; shared borrower tasks have no task documents while staff still do; history opens from “Details and history”; completed review notes are inside Details; the documents spec attaches a file to a task from the Documents page.
- Desktop/mobile borrower and staff screenshots were inspected: the task list sits on the page with each task as its own card, the expanded task shows the question, field and actions, and Details holds the reason, metadata and history. The task order was unchanged after saving and submitting an answer.

## V2-03 — Demo text importer and registered fixtures

Dependencies: T13, T14, D05. Primary areas: demo catalog/transfer UI, protected importer, synthetic PDF generator and document pipeline.

### Scope

- Extend the existing demo section with drag/drop and equivalent file-picker import for explicitly registered text fixture filenames. Display the supported mapping, generated document type and expected simulated outcome.
- Resolve a bounded, versioned fixture manifest as specified in [data and simulation](03-data-and-simulation.md); generate a visibly synthetic PDF and registered typed extraction/findings from that fixture. Never interpret text content as executable instructions or an arbitrary outcome definition.
- Send generated PDF bytes through normal authorized reservation/upload, quarantine/scan, immutable versioning and delayed processing. Bind the result to validated fixture identity/content; the original filename alone does not grant access or bypass the pipeline.
- Preserve D05's ordinary content-bound PDF behavior: renaming arbitrary uploaded bytes cannot select a fixture outcome. Reject unknown/ambiguous importer names with actionable feedback and no document mutation; do not claim a filename-driven result for ordinary uploads.

### Acceptance and tests

1. Known text fixtures produce expected tax-return/bank-statement PDFs and delayed mock fields/findings on both dashboards. Generated PDFs are parseable, readable and labeled synthetic; demonstrate three distinct tax-year documents.
2. Unknown names, malformed/oversized inputs and forged import requests fail safely. Text containing instructions has no authority. Filename/path normalization cannot select an unintended fixture or escape the allowlist.
3. Real-PostgreSQL and both-transport tests cover authorization, revoked/private targets, idempotent command retries, intentional separate uploads, transactional failure, duplicate delivery, blocked scans and stale document versions.
4. Processing failures retain permitted clean original downloads and retry history. Staff corrections and accepted task evidence remain separate from mock findings; no field confirmation or requirement completion occurs automatically.
5. Desktop/mobile keyboard and drag/drop flows expose equivalent behavior, clear loading/errors and no scenario-panel overlap. Ordinary renamed PDFs retain content-based classification.

Implementation record: **Done — local acceptance, October 8, 2026.**

- The shared demo panel accepts the five exact registered text basenames through its picker or drop area. It shows generated PDF type, period, exact supplied amounts, application snapshot, printed business and simulated outcome before Download/Drag/Upload. UTF-8 validation rejects paths, ambiguous extensions, compatibility aliases, hidden controls, malformed bytes, oversized input and batches above ten. Text instructions remain inert; unknown files create no evidence.
- Three two-page tax returns (2023–2025) print net sales and ordinary income separately from explicit adjustments/adjusted income on a supporting schedule. The January statement preserves deposits as deposits; the review sample names another fictional business and leaves missing adjusted income unknown. Typed suggestions carry period, USD, recipe and source-page provenance. Ready-to-use text stubs are under `packages/testing/fixtures/demo-imports`.
- Both transports use the existing authenticated reservation, private streaming storage, scan and delayed interpretation. Migration `0022_demo_import_fixtures.sql` adds a nullable immutable-version recipe/context snapshot. Import reservations validate current application context and expected bytes; local and R2 storage reject an altered checksum before publishing. The server recognizes downloaded/renamed generated PDFs only by exact reconstruction of every byte, never a filename or unverified marker.
- Existing permission/lifecycle gates, idempotency, retry history and stale-version/name protection remain authoritative. Business importer samples cannot enter private-subject targets. No result confirms financial facts, completes evidence review or advances an application. V2-04 owns the separate reviewed-fact workflow. Independent backend/UI review found and closed the configurable batch-limit edge case.

Validation record — October 8, 2026:

- **362 unit tests across 34 files passed** with `node_modules/node/bin/node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts'`. New coverage includes strict names/UTF-8/size/batch validation, inert instructions, all five PDFs, Unicode contexts, byte tampering, printed/source periods, supplied versus missing adjusted income, retained-name comparisons, drag metadata and checksum-before-publication recovery for local/R2 storage. The first sandboxed run could not open loopback test sockets; the final run passed with local networking enabled.
- **418 real-PostgreSQL tests across 44 files passed**, including 22 new importer/domain/both-transport/upgrade cases. Ran the installed Vitest `run .integration.test.ts` after the existing `assertLocalTarget`, `assertOwnedDatabase` and `waitForDatabase` preflight, with the local test URL passed only in process memory. Covers cross-bank/application/restricted/revoked/private denial, forged requests and bytes, idempotent versus intentional separate uploads, audit rollback, fixed importer batch limits, delayed scan/interpretation, duplicate/stale delivery, replacement/name changes and no automatic review. The existing suite also preserves blocked-scan, failed-processing/download and correction-history behavior.
- **40 desktop/mobile browser cases passed with no failures, skips or flaky cases.** New importer suite: 12/12, report `.local/e2e-caaHdt`; existing scenario/document/processing regressions: 28/28, `.local/e2e-n3tjR2`. Commands used `node_modules/node/bin/node --import tsx scripts/e2e.ts` with `tests/e2e/demo-text-import.spec.ts`, then `tests/e2e/demo-scenarios.spec.ts tests/e2e/documents.spec.ts tests/e2e/document-processing.spec.ts`. Coverage includes both dashboards, borrower sidebar, keyboard/picker/drop parity, ordinary text denial, renamed PDF behavior, recoverable errors, restricted targets and layout. Initial test-selector/fixture errors were repaired before the final passing runs. Desktop/mobile preview screenshots in the importer report were visually inspected.
- All **12 workspace typechecks and builds**, root TypeScript, Biome and browser-boundary checks passed. All **268 local Markdown paths/anchors** and `git diff --check` passed. The host pnpm launcher could not verify its registry signature; installed Node 24.21.0 and repository binaries ran the corresponding package scripts directly, with no dependency or lockfile changes. Final check/build/unit/integration logs are under `.local/v2-03-validation`.
- All five generated PDFs were parsed with pypdf and their printed periods/values checked; standard tax, adjustment, statement and review pages were rendered with Poppler and visually verified. QA PDFs/renders are in `.local/v2-03-validation/pdfs`. The additive migration applied to a populated pre-0022 test database without changing historical documents, and repeat migration/seed passed. Local development migration apply/repeat no-op and schema readiness passed; restarting the existing worker watcher restored API readiness with database and worker both ready. No data reset or hosted deployment occurred.

Try locally: open the borrower or staff application and its demo kit, choose one of the `.txt` files in `packages/testing/fixtures/demo-imports`, review the generated facts, then Upload or drag the preview to the authorized upload area. Open Documents to inspect the clean PDF and delayed simulated findings. At that checkpoint, V2-04 was the next default task.

## V2-04 — Document workspace and reviewed financial facts

Dependencies: V2-01, V2-03; T14, T15, T19. Primary areas: shared document viewer, interpretation DTOs, financial-fact domain/schema and lender review.

### Scope

- Add a lender document modal with private PDF preview on the left and Analysis, Document info and version/history views on the right. On narrow screens expose the same content without forcing two unreadable columns.
- Show classification, period, source filename/version, processing status, typed extracted fields and simulated findings. Separate original extraction, manual category correction and human-confirmed facts.
- Add explicit revision-checked lender confirmation/rejection for selected financial facts, retaining document/version/run/period/unit, reviewer, timestamp and correction history. Store application-scoped confirmed facts with provenance; do not silently overwrite business records shared by other applications.
- Define revenue/sales and adjusted net income precisely per the data specification; do not equate bank deposits with revenue or ordinary net income with adjusted net income. Unavailable facts remain unavailable.
- Retain task evidence acceptance, application decisions and confirmed financial facts as separate actions. Fence stale/replaced source results and submitted/decided snapshot changes under the existing lifecycle policy.

### Acceptance and tests

1. Open each of three year-specific tax documents through the existing Documents view; preview, metadata, period and analysis refer to the same authorized version. Failure/history states remain readable and original clean downloads still work. V2-05 owns the grouped Overview entry point, avoiding a circular dependency.
2. Real-PostgreSQL and both-transport tests verify deliberate confirmation, rejection/correction history, decimal money values, period/unit separation, conflicting revisions, duplicate commands and immutable provenance.
3. Replacing/reclassifying/reprocessing evidence cannot silently update confirmed metrics. Old sources are visibly stale, current confirmed selection follows the documented rule, and frozen decision evidence remains unchanged.
4. Bank/application/document permissions apply independently to bytes, metadata, analysis, versions and confirmed facts. Test guessed IDs, restricted roles and revocation while a modal is open; preview resources are released when closed or denied.
5. Browser checks cover desktop split view, mobile layout, keyboard open/close and focus return, loading/failed preview, analysis selection and explicit financial confirmation. Fit-width rendering must settle with classic scrollbars after opening, page changes, zoom/Fit and resizing. No real OCR provider is called.

Implementation record: **Done — local acceptance, October 8, 2026.**

- Lender Documents opens a modal for an exact document version with Analysis, Document Info and Versions/history views. Metadata exposes the original filename, source recipe/period, uploader and permitted business/subject context. Display name, description, expected period and manual category corrections are staff-only and revision-checked. The bundled PDF.js renderer now displays the authorized PDF with selectable text, page navigation and zoom; its actual in-app browser appearance has been visually inspected. Desktop/mobile acceptance passed for the split/stacked layout, keyboard/focus restoration, page/source navigation, loading/failure, version switching, financial review and denied-access cleanup.
- Additive migration `0023_next_mephisto` adds immutable `document_metadata_revisions`, `financial_fact_reviews` and `financial_fact_commands`. Expected-period changes increment the analysis revision and transactionally fence prior runs before queuing a new interpretation. Display-only changes preserve the analysis revision. Current source reads and commands check independent bank/application/document access.
- Both Fastify and native Workers transports expose financial reads/reviews and metadata updates through shared domain services. Financial review revalidates the current clean version, successful current run, printed business identity, category, actual/expected period and optimistic revisions before committing all selected dispositions, fact history, application revision, audit and replay response. Failed validation writes nothing; repeated identical commands return their original result, and conflicting payloads or revisions require deliberate review.
- Facts remain scoped to the application's business snapshot. Accept/Correct append a fact revision; Reject appends a disposition without replacing the prior accepted fact. The current selection is the highest accepted/corrected revision for a metric and exact period/basis/currency/unit. Correct changes only the exact two-decimal value; it retains the original candidate and explicit adjustment provenance. Deposits, ordinary income and adjusted net income remain distinct. Source replacement/reprocessing, category/analysis metadata changes and business-identity changes mark accepted sources stale without substituting new suggestions.
- Existing lifecycle locks apply. Submission and decision snapshots retain accepted fact-version references and source state; historical fingerprints with no accepted facts remain compatible. No existing rule consumes these financial facts, so no new readiness gate or unrelated task/check invalidation is added. Overview cards/grouping and geography remain V2-05/V2-06; no hosted deployment is included.

Validation record — working tree based on `893873c`, October 8, 2026:

- `pnpm check` passed: Biome, browser/server boundary checks, all **12 workspace typechecks**, root TypeScript and **367 unit tests across 36 files**.
- `pnpm build` passed all **12 workspace builds**. PDF.js is loaded only by the bank-console preview; the lazy renderer chunk is approximately 432 KB and its bundled worker is approximately 1.26 MB. No remote PDF/OCR service is used.
- The full real-PostgreSQL suite passed **442 cases across 47 files**, including both HTTP transports and the populated pre-0023 upgrade/repeat migration. Applying the migration to the existing local development database, repeating it as a no-op and checking schema readiness also passed without resetting application data. The final financial-domain rerun passed **19 cases** after independently validating the printed business subject. Coverage includes exact decimals, separate fiscal years and statement metrics, correction/rejection provenance, duplicate/concurrent commands, stale sources, scoped/revoked access, seven locked statuses, atomic rollback, database immutability and frozen submission/decision references.
- **46 distinct desktop/mobile browser cases passed, with zero failed, skipped or flaky cases**: 14 document-workspace cases and 32 existing upload/processing/demo-text-import regressions. The initial 12 workspace cases passed in `.local/e2e-Quo8i8`; the final preview follow-up passed four cases in `.local/e2e-hHjxXr`, adding two renderer-module failure/recovery cases and rechecking two affected earlier cases. The regression report is `.local/e2e-MqgatX`.
- The actual PDF.js preview was visually inspected in the in-app browser with rendered, selectable text. An initial browser-native PDF iframe left the custom page/zoom controls unverified; replacing it with the bundled renderer closed that gap. Form-refresh and denial cleanup issues were repaired before passing acceptance. Renderer-module startup failure now keeps an authorized Download action and a reload recovery action with an unsaved-edits notice; actual reload recovery and rendered PDF pixels passed the final follow-up. `pnpm check` and `pnpm build` passed again after that final UI repair. Backend/check/build logs are under `.local/v2-04-validation`.
- Local Markdown verification checked **286 paths/anchors across 45 files**, with zero errors; `git diff --check` passed. No hosted deployment or v2 hosted parity is claimed.

Commands used were `pnpm check`, `pnpm build`, the guarded `node_modules/node/bin/node --import tsx .local/v2-04-validation/integration.mjs .integration.test.ts` runner, and `node_modules/node/bin/node --import tsx scripts/e2e.ts` with `tests/e2e/document-workspace.spec.ts` or `tests/e2e/documents.spec.ts tests/e2e/document-processing.spec.ts tests/e2e/demo-text-import.spec.ts`, plus the final targeted workspace preview rerun. The host pnpm launcher could not verify its registry signature, so the pinned Node 24.21.0 and temporary cached pnpm 10.34.6 CLI were placed on `PATH` to run the existing scripts. The repository retains one pnpm lockfile; the bundled `pdfjs-dist` dependency is pinned to 6.4.299.

During local verification, the borrower Vite process on port 3001 retained a cached shared-contract export graph. Restarting that watcher restored the existing exports; no package-export workaround was needed. The migration is additive, with ordinary startup/initialization still preserving application data.

Try locally: sign into the lender console as `officer-a@example.test`, open an editable synthetic application and its Documents view, then use the Scenario kit's text importer to upload the three year-specific tax fixtures. Wait for clean scan and simulated interpretation, then open a file's document workspace. Compare its selected version, period and original suggestion; select a financial field, choose Accept/Reject/Correct, enter a review reason and apply. A changed prior accepted amount requires explicit replacement confirmation. Inspect review history and version/source labels. Metadata expected-period edits or a replacement PDF require fresh source review; they do not silently change the accepted value. Financial review is separate from accepting task evidence or deciding the application.

### Modal preview stability — October 8, 2026

Follow-up status: **Done — local acceptance.**

- Reproduced a fit-width feedback loop near the preview's scrollbar threshold: the in-flow rendering status changed overflow, changing the measured width and starting another render. The failing baseline recorded 160 canvas dimension mutations and 40 rendering-status frames in one second (`.local/e2e-l6B3NV/shard-1.log`).
- The rendering status is now an overlay, and the preview reserves scrollbar space. Page/version/access cleanup still immediately clears private pixels; authorized byte loading, controls and resource release retain their existing behavior. The regression enables classic scrollbars and checks rendered text plus a full second without canvas dimension changes, recurring loading status or empty frames after each interaction.
- The full document-workspace suite passed **16 desktop/mobile cases with zero failures, skips or flakes** (`.local/e2e-3PfOb5`). Both layouts passed the new stability regression after opening, changing pages, zooming, returning to Fit and resizing. Existing exact-byte/source, reviewed financial, history, recovery, access-loss and private-resource cleanup cases also passed. Command: `node_modules/node/bin/node --import tsx scripts/e2e.ts tests/e2e/document-workspace.spec.ts`.
- `pnpm check` passed Biome, boundaries, all 12 workspace typechecks, root TypeScript and 373 unit tests across 37 files. `pnpm build` passed all 12 workspaces. Logs are in `.local/modal-glitch`. The running local modal was visually checked after zooming and returning to Fit. No backend, schema, dependency or hosted deployment changes are included.

## V2-05 — Lender overview and evidence drilldowns

Dependencies: V2-01, V2-04; T10, T12, T16, T19, T21. Primary areas: lender workspace/read model and existing document/task/check entry points.

### Scope

- Retain the lender application queue and top section tabs. Make application Overview the default detail view with business/legal/address/website/NAICS details, loan amount/purposes and reviewed financial metrics with periods and source links.
- Show stage, current/finished application items and relevant history. Label requirements, uploaded evidence, checks and review actions accurately instead of presenting every row as a borrower task.
- Add grouped tax-document drill-down with authorized counts, year/status summaries and links into V2-04. Missing or unconfirmed metrics show an explicit empty state rather than fabricated zero values.
- Preserve staff creation/prefill/borrower handoff, assignment, notes, invitations, review, operations and closing. Add the Loan Footprint entry point when V2-06 is available; no placeholder may claim a passed geographic check.

### Acceptance and tests

1. Open an application from the existing filtered/paginated queue and see business, loan, financial and stage sections. Existing tabs and workflows remain reachable; return navigation preserves useful queue context.
2. A group with three visible tax documents reports three documents, with version counts distinguished. Opening a year/document reaches the matching analysis and private preview.
3. Overview financial values use V2-04's confirmed fact policy and link to the exact evidence. Selecting a financial card opens period history with a chart and equivalent accessible table; unavailable/noncomparable periods are not fabricated. Stale/unconfirmed/missing facts and incomplete legacy details remain distinguishable.
4. Real-PostgreSQL/HTTP checks cover scoped aggregate counts and facts, bank isolation, stale revisions and lifecycle restrictions. Desktop/mobile keyboard checks cover drill-down, history, empty states and scenario-panel layout.

Implementation record: **Done — local acceptance, October 8, 2026.**

- The default lender Overview retains every section tab and queue filter/page context. Business profile and loan application sections show saved legal/address/website/NAICS details, amount/purposes, staff assignment and actual stage; absent optional/legacy details are explicit. Existing prefill, handoff, assignment and notes remain reachable.
- Revenue and explicitly adjusted net income cards use V2-04 accepted facts, retaining exact USD decimals and separate missing, unconfirmed, current and stale-source states. Expand a card for a chart and equivalent table grouped by business snapshot, currency/unit, basis and comparable period shape. Only existing reviewed periods appear; no zero fill, computed DSCR, inferred adjusted income or percentage change is introduced. Each source opens its exact document/version/analysis run in the existing private workspace.
- A staff-only `GET /api/v1/banks/:bankId/applications/:applicationId/overview` in both HTTP transports reads financial facts and visible documents within one application transaction. The tax group separates logical documents, uploaded versions, financial-review states and distinct reviewed fiscal periods; task-evidence acceptance is separately labelled. Personal tax evidence is excluded. Reanalysis/pending replacements preserve an explicit previous-classification state; manual category corrections remain authoritative.
- Expandable application stages distinguish action-required requirements, submitted review actions, finished/cancelled records, completed setup answers and simulated check results. Recent authorized activity links to full history. This adds no new write command, migration, workflow gate, approval action or provider. Loan Footprint remains V2-06.
- Document dialogs stay inside the expanded Overview and return keyboard focus. A fresh document-list read precedes unavailable-source checks, preventing old cached lists from incorrectly denying newly discovered documents. New application revisions refresh the profile/stage record, and source review invalidates the aggregate; source buttons retain focus across immutable accepted revisions.

Validation record — working tree based on `fcd45b3`, October 8, 2026:

- `pnpm check` passed Biome, package boundaries, all 12 workspace typechecks, root TypeScript and 373 unit tests across 37 files. `pnpm build` passed all 12 workspaces.
- The final full real-PostgreSQL suite passed **449 cases across 48 files**, including seven new overview cases, both HTTP transports and the existing financial revision/lifecycle/immutable snapshot cases. Scope/revocation, logical documents versus replacement versions, duplicate periods, explicit rejection, pending reanalysis and manual category overrides are covered. The final HTTP follow-up after native OpenAPI registration passed four cases. No schema or migration changed.
- **42 distinct desktop/mobile browser cases passed.** The existing staff workspace and document-workspace regressions passed all 30 cases with zero failures/skips/flakes (`.local/e2e-jLqf1Y`). The 12 new overview cases passed through final targeted runs: profile/stages, grouped three-year previews and loading/retry in `.local/e2e-GkWK4N` (shards 2, 3, 5, 7, 8, 10); final queue/empty-state keyboard cases in `.local/e2e-c7c7ju`; cached replacement on both layouts and mobile financial history in `.local/e2e-4Fiy5N` (shards 2–4); final desktop financial history in `.local/e2e-atefsX`. Earlier failed attempts exposed a real rapid-filter URL race and lazy-cache refresh gap, plus fixture selector/timing issues. Each affected case was repaired and passed; runtime rate limits stayed enabled, with deliberate request pacing only in the dense financial browser fixture.
- Desktop/mobile overview screenshots and financial chart/table regions were visually inspected. Evidence groups and exact private PDF bytes/analysis periods, stale accepted sources, focus restoration, empty states and demo-panel layout passed; horizontal table scrolling stays within the financial card on mobile. Final local Markdown verification checked **289 paths/anchors across 45 files** with zero errors; `git diff --check` passed.
- Logs are in `.local/v2-05-validation`. Commands were `pnpm check`, `pnpm build`, `node_modules/node/bin/node --import tsx .local/v2-04-validation/integration.mjs .integration.test.ts`, the final HTTP-only rerun with `apps/api/test/document-workspace.integration.test.ts`, and `node_modules/node/bin/node --import tsx scripts/e2e.ts` with `tests/e2e/lender-overview-v2.spec.ts` (targeted `--grep`/`--project` reruns), or `tests/e2e/staff-workspace.spec.ts tests/e2e/document-workspace.spec.ts`. Pinned Node 24.21.0 and the cached pnpm 10.34.6 CLI were placed on `PATH`; local sandbox permissions were extended for the owned Podman target, loopback services and test-runner IPC. No hosted deployment or v2 hosted parity is claimed.

Try locally: sign in as `officer-a@example.test`, filter the application queue and open an application. Overview shows its saved profile, loan and stages. Import three year-specific synthetic tax fixtures from Documents, explicitly accept revenue/adjusted-income suggestions, then return to Overview. Expand Business tax returns to inspect each file and its version count; expand either financial card to compare the available periods and open exact source evidence. Close the document to return to the same group/source; Back to applications restores the queue filters and page.

### Readable default typography — October 8, 2026

Follow-up status: **Done — local acceptance.** Regular compact UI copy now uses 1rem (16px at the default browser setting); secondary copy and small buttons use 0.875rem (14px). Shared Tailwind text tokens and the small-button variant replace the prior 14px/12px/12.8px mix. Rem units preserve browser font preferences. Acceptance requires the overview, borrower dashboard and document modal to remain usable on desktop and mobile with the larger text.

- Live browser measurements confirmed a 16px root and 16px/14px UI text. Desktop and 390px mobile overview were visually inspected without page-level horizontal overflow.
- All **six existing desktop/mobile layout cases passed**, with zero failures/skips/flakes (`.local/e2e-E8a3F1`): lender business/loan details and scenario controls, borrower progress/sidebar reachability, and three fiscal-year document previews. Ran `node_modules/node/bin/node --import tsx scripts/e2e.ts tests/e2e/lender-overview-v2.spec.ts tests/e2e/borrower-dashboard-v2.spec.ts tests/e2e/document-workspace.spec.ts --grep 'v2 business and loan details|application progress expands|three fiscal-year documents'`.
- `pnpm check` passed Biome, boundaries, all 12 workspace typechecks, root TypeScript and 373 unit tests. `pnpm build` passed all 12 workspaces. Logs are `.local/modal-glitch/typography-*.log`. This is a local styling change; no hosted deployment is claimed.

## V2-06 — Simulated Loan Footprint

Dependencies: V2-01; T16. Primary areas: address-bound simulated geographic result, lender Checks/overview and map modal.

### Scope

- Add a Loan Footprint item opening a modal with business address, simulated map/pin and geographic status. Use bundled synthetic map data/coordinates and accessible address/status text; no live geocoder or map provider is necessary.
- Treat any structurally valid U.S. address as geographically eligible for this demo, independently of map-coordinate availability. Non-U.S. input must not be green; missing/invalid address remains unknown or waiting for input. No additional state/region restrictions or readiness gates are introduced.
- Bind results to address revision and the simulated rule version, with safe history and explicit simulation labeling. Do not claim identity verification or a real lending decision.
- Expose and test the modal through existing Checks until V2-05 is ready; V2-07 verifies the overview entry point.

### Acceptance and tests

1. A valid synthetic U.S. address opens green simulated eligibility. Registered coordinates show a labeled pin; a valid U.S. address without coordinates stays clear with “Map location unavailable.” Outside-U.S. and missing/invalid inputs have negative automated coverage even though no outside-country demo scenario is required. Verify this informational check adds no submission, approval or funding gate.
2. Address edits invalidate older results/pins; duplicate deliveries and late results cannot restore an outdated green status. Real-PostgreSQL and both-transport checks enforce scope, revisions and revocation.
3. Desktop/mobile keyboard users can open, inspect and close the modal with focus restored. Text communicates the result without reliance on map imagery or color; no real provider request is made.

Implementation record: **Done — local acceptance, October 8, 2026.**

- Lender Overview and Checks open the same accessible Geographic Eligibility dialog. It shows the saved address, explicit simulated status, evaluated time/address revision, policy, registered synthetic map/pin and historical runs. Unknown coordinates or a failed bundled illustration show Map location unavailable without changing the country result. Keyboard open/Escape/Close restore focus; scrolling keeps actions reachable on mobile. Pending, error, stale and lost-access states never retain a current green result or pin.
- Existing `application_checks`/`check_runs` now support staff-only `loan_footprint` under `US-only-demo-v1`. Complete US addresses clear independently of coordinate availability; non-US returns needs-review and missing/invalid inputs wait. Database policy enforces `required=false` and no staff resolution override. No submission, approval or funding gate is introduced, and decision snapshots exclude this informational check.
- Migration `0024_curious_spencer_smythe` adds address snapshots and scoped one-successor refresh links, then backfills checks and queued/waiting intent for existing synthetic applications, including frozen legacy records. It preserves application/setup revisions, existing evidence and decisions. Creates and address saves persist current intent and invalidate old claims in the same transaction. Worker completion validates current fingerprints, claim tokens, address snapshot and registered coordinates; duplicate or late deliveries cannot restore an obsolete result.
- Staff `POST .../checks/:checkId/refresh` uses current run ID and expected address revision. Concurrent/replayed requests enqueue one successor with safe audit history. Informational checks may execute/refresh throughout the lifecycle without modifying frozen decision inputs. Existing identity/fraud guards remain; every environment remains a demo and the map/provider require no external request.

Validation record — working tree based on `7795567`, October 8, 2026:

- `pnpm check` passed Biome, package boundaries, all 12 workspace typechecks, root TypeScript and **399 unit tests across 38 files**. `pnpm build` passed all 12 workspaces. Thirteen UI state cases cover stale snapshots, pending/error evidence, structured-address comparisons and invalid/map-outside coordinates; provider/contracts cover delayed outcomes, invalid input and strict country/result agreement.
- The final full real-PostgreSQL suite passed **477 cases across 50 files**, including 17 dedicated footprint cases, one upgrade case and 10 new cases across both Fastify and native Worker HTTP transports. Coverage includes all ten application lifecycle states with identical readiness before/after, automatic draft intent, rollback, simultaneous duplicate claims, refresh replay, stale in-flight results across an actual HTTP address edit, bank/application boundaries, staff revocation, borrower/adviser exclusion, malformed result/coordinate rejection, failures, scoped foreign keys and legacy/frozen migration preservation. A final 23-case footprint/activity rerun also passed after safe refresh-history labeling.
- All **10 new desktop/mobile browser cases passed**, with no remaining failures/skips/flakes: registered map and both entry points, unregistered-US versus changed non-US address, missing address, queued/running/error/stale display, real image-render failure, asynchronous refresh, temporary read recovery and access-loss cleanup. Initial `.local/e2e-fb8pzW` passed eight; desktop failures were test-only hidden-history scope and Vite-inline-image interception assumptions. Corrected desktop cases passed `.local/e2e-kGIymX`; mobile counterparts already passed with the corrections. Desktop/mobile dialog screenshots were visually inspected, including current map, missing and non-US states.
- **Six affected desktop/mobile regressions also passed**, bringing acceptance to **16 distinct browser cases**: existing synthetic identity/fraud review/retry, lender profile/stages/scenario layout, and two-party signatures through explicit simulated funding. `.local/e2e-yvepUC` passed eight of ten cases, including four strengthened footprint viewport/map checks and four overview/funding regressions. Its two old Checks failures were an obsolete borrower heading and a 25-second wait shorter than the established 30-second idle poll. Updated test expectations passed both layouts in `.local/e2e-8PaqNS`; no product timeout or polling change was made. Header/Close remained in the viewport while the map scrolled into view. Final local Markdown validation checked **298 paths/anchors across 45 files**, with zero errors; `git diff --check` passed.
- The additive migration was applied to the project-owned local database with `pnpm db:migrate`, repeated successfully as a no-op, and authenticated database/schema readiness passed. Upgrade tests preserve existing application/setup records, address snapshots and frozen decisions. No data reset was used.
- Logs are `.local/v2-06-validation`. Commands were `pnpm check`, `pnpm build`, `node_modules/node/bin/node --import tsx .local/v2-04-validation/integration.mjs .integration.test.ts`, and `node_modules/node/bin/node --import tsx scripts/e2e.ts tests/e2e/loan-footprint-v2.spec.ts`, with targeted desktop reruns. Pinned Node 24.21.0 and cached pnpm 10.34.6 were used. Local sandbox permissions were extended for the owned Podman database, loopback HTTP and test IPC. No hosted build/deployment or v2 hosted parity is claimed; V2-07 and V2-08 remain separate.

Try locally: sign in to the lender console as `officer-a@example.test`, open an application and choose **Loan Footprint** in Overview or Checks. A saved US address evaluates after the configured simulation delay. The registered `123 Synthetic Avenue, Portland, ME 04101, US` fixture displays a labelled synthetic pin; another complete US address remains eligible with Map location unavailable. A legacy application without an address shows Needs address. Refresh creates one asynchronous successor and retains explicitly historical prior runs.


## V2-07 — Integrated local acceptance

Dependencies: V2-02–V2-06; T22. Primary areas: focused integration/browser journeys, demo instructions and validation record.

### Scope and acceptance

1. Run a new synthetic borrower from email-first setup through resume, illustrated purposes, tabless dashboard, text fixture import, delayed processing, lender grouped documents, modal review, confirmed metrics and Loan Footprint. Verify the existing human review/signature/closing/simulated-funding journey remains usable.
2. Exercise incomplete and completed legacy applications, staff prefill/handoff, another business/application, restricted adviser and revoked participant. Validate direct API denials as well as UI states, including private document/metric aggregate leakage and stale evidence/address results.
3. Verify clean migrations and an upgrade containing legacy records on real PostgreSQL; repeat ordinary initialization without data loss. Inject job retries/restarts and revision conflicts without duplicating business effects.
4. Run affected unit/HTTP/real-PostgreSQL suites, both local transport adapters, `pnpm check`, `pnpm build`, and desktop/mobile browser journeys. Visually inspect the dashboard, scenario kit and modals; check keyboard focus and no overlap/overflow.
5. Record the tested revision, commands, actual results and any limits. Update the demo guide and requirement map; do not claim hosted completion or re-enable paused CI without separate direction.

Implementation record: **Done — local acceptance, October 8, 2026.**

- Added one connected desktop/mobile journey in `tests/e2e/v2-integrated.spec.ts`: a new email-first applicant completes expanded setup, resumes saved purposes after browser storage/cookie loss, enters the tabless dashboard, imports three tax returns and a statement, waits for protected scan/processing, then reaches lender grouped evidence, private PDF previews, six deliberately reviewed facts/history and Loan Footprint. General uploads and financial reviews leave task states and application lifecycle unchanged.
- Strengthened both HTTP transports with actual accepted metrics and shared/private files before testing an assigned adviser and the same client after persisted revocation. Before revocation, the adviser list includes only granted shared documents; private bytes, financial aggregates, retry actions and accepted-command replays remain denied without leaking private values or identifiers. After revocation, the list and formerly shared bytes are denied too.
- Repaired the setup-session recovery regression exposed by the integrated run. Actor-bound setup requests can recover known session 401s without the parent clearing the ordinary unsaved answer; unsaved EIN is erased. Initial/latest setup reads are actor-bound. Stale-account writes, permission denials and portal cache clearing retain their guards. Eleven new unit cases and the strengthened real-session browser journey cover this boundary.
- Updated [the combined demo walkthrough](../../../README.md#combined-v2-walkthrough-locally), requirement map and task indexes. No schema or dependency change was needed.

Validation record — **`bf845a168d456143e51f01034eb57f51c5839e21` plus the V2-07 working-tree changes**, October 8, 2026. `.local/v2-07-validation/tested-source.json` records SHA-256 hashes of all six changed/new code and test files so the tested delta is explicit.

| Check | Actual result and evidence |
| --- | --- |
| Unit, Biome, boundaries and TypeScript | `pnpm check` passed: **410 unit tests**, all **12 workspace typechecks**, root TypeScript, Biome and browser/server boundaries. `check-final.log` records the final repair. |
| Workspace builds | `pnpm build` passed all **12 workspace builds/checks**, including the repaired borrower app; `build-final.log`. |
| Real PostgreSQL and both HTTP transports | `pnpm test:integration` passed **477 cases across 50 files**. After the two added transport cases, the updated document-workspace file passed **6/6**, giving **479 distinct cases**. `postgresql.log` and `document-workspace-postgresql.log`. |
| Migration and startup preservation | All **25 committed migrations** run cleanly in disposable PostgreSQL databases. Populated upgrades cover every legacy setup step, completed/frozen applications, immutable document/decision evidence and footprint revisions. Two ordinary `pnpm initialize` runs preserved exact environment bytes and full synthetic bank/application/setup rows, including v2 answers/revisions/skips; invalid credentials stopped `pnpm dev` before app launch. `repeated-initialize.log` and its `preserve-initialize.ts` probe. |
| Recovery and concurrency | The full database run includes a real separate-worker SIGKILL/restart, duplicate dispatch/effect deduplication, transaction rollback, concurrent financial reviews, replaced documents, expired leases and in-flight address changes. These use real PostgreSQL and injected time where applicable. |
| Combined desktop/mobile browsers | **136 distinct cases have final passing results**, with no unresolved failures, skips or flakes. `.local/v2-07-validation/browser-acceptance.json` records each final case/report. Run breakdown and the repaired initial failure are below. |
| Documentation | All **305 local Markdown paths/anchors across 45 files**, final Biome and `git diff --check` passed. `links.log`. |
| Visual and keyboard inspection | Inspected desktop/mobile borrower dashboard, scenario kit, PDF workspace, financial history and geographic modal/map screenshots. The connected journey checks keyboard purposes/import picker, modal Escape/focus return and no page overflow; related suites verify preview/page/zoom/resize stability and reachable controls. Twelve connected-journey images are in `.local/e2e-jKpAqB/shard-1/` and `shard-2/`. |

Browser commands use `node_modules/node/bin/node --import tsx scripts/e2e.ts` followed by these arguments:

- `tests/e2e/borrower-workspace.spec.ts tests/e2e/borrower-dashboard-v2.spec.ts tests/e2e/borrower-dashboard-safety.spec.ts tests/e2e/participants.spec.ts tests/e2e/staff-workspace.spec.ts tests/e2e/closing.spec.ts`: **52/52**, `.local/e2e-JIHiYP`. Covers legacy-shaped incomplete/completed fixtures, separate applications/businesses, staff prefill/handoff, scoped invitations/revocation, contextual navigation, two-party signatures and replay-safe simulated funding.
- `tests/e2e/intake.spec.ts tests/e2e/industry.spec.ts tests/e2e/demo-text-import.spec.ts tests/e2e/document-workspace.spec.ts tests/e2e/lender-overview-v2.spec.ts tests/e2e/loan-footprint-v2.spec.ts`: **65/66 initially**, `.local/e2e-q4ohI5`. The desktop session-recovery failure exposed the repaired product bug; its desktop/mobile rerun below passes. Unknown/blocked/renamed imports, exact private sources, conflicting/stale reviews, denied cleanup, US/non-US/missing/stale geography and map failures are covered.
- `tests/e2e/demo-inbox.spec.ts tests/e2e/review.spec.ts` with `DEMO_INBOX_ENABLED=true`: **14/14**, `.local/e2e-M9Ks9c`. Deliberate simulated inbox confirmation/resume, submission, returned information, resubmission, human approval/decline and withdrawal pass.
- `tests/e2e/v2-integrated.spec.ts`: **2/2**, `.local/e2e-jKpAqB`. Initial test-authoring runs corrected the canonical website trailing slash, paced requests under unchanged real rate limits and allowed asynchronous view readiness before this final pass.
- `tests/e2e/intake.spec.ts tests/e2e/borrower-dashboard-safety.spec.ts tests/e2e/collaborator-upload.spec.ts --grep 'session recovery|a denied task mutation|invited adviser'`: **6/6**, `.local/e2e-HTaX4J`. Strengthened EIN/ordinary-answer recovery, zero stale-account mutations, immediate denied-task clearing and real adviser private-evidence/revocation checks. Four cases overlap the sets above; two adviser cases bring the distinct total to 136.

Limits: all acceptance is local. Browser legacy fixtures demonstrate legacy-shaped behavior; actual populated migration preservation is proved separately by the PostgreSQL upgrade suites. Initialization first added missing defaults to the existing older `.env`; the two subsequent preservation probes passed byte-for-byte. The shared Podman database was not stopped; worker-process restart was tested in an isolated database. Pinned Node 24.21.0 and cached pnpm 10.34.6 ran the repository scripts; sandbox access was extended for the owned database, loopback services, Chromium and test IPC. Final logs are under `.local/v2-07-validation`. All owned browser processes/databases were cleaned up. At this local checkpoint, V2-08 remained unstarted and no hosted build/deployment, hosted parity or CI re-enablement was claimed. The V2-08 record below supersedes that deployment status.

## V2-08 — Hosted parity and deployment slice

Dependencies: V2-07; D02 and D03, including deployed simulation/authentication configuration. Primary areas: existing five-Worker deployment, committed migrations, R2/queue adapters and hosted browser acceptance.

### Scope and acceptance

1. Carry the combined v2 implementation and required prior local-only follow-ups through the existing deployment process. Apply additive committed migrations through the established migration workflow; verify repeat no-op behavior and retain existing hosted synthetic records.
2. Verify all five native Worker builds and required bindings/configuration. Keep authentication and email simulated and retain D03's `AUTH_DELIVERY_UNAVAILABLE` recovery behavior; no environment may enable real services implicitly.
3. On actual hosted URLs, use new synthetic records to demonstrate setup/resume, optional EIN masking, borrower layout, text import, real R2 byte upload/download, queue processing, lender document review/confirmed metrics and address-bound Loan Footprint.
4. Exercise at least one scoped denial and a stale/retry case through hosted adapters. Record actual URLs, deployed revision, migration result, browser report and simulation labels without tokens, raw identifiers or private evidence.
5. Distinguish full local negative coverage from the smaller hosted slice. Deployment/build success alone cannot close this task; remaining hosted failures or unverified criteria stay explicit in the task/index.

Implementation record: **Done — hosted acceptance, October 8, 2026.**

- Deployed the combined v2 implementation and earlier local-only follow-ups through the existing five native Git builds. Runtime review repaired two parity gaps: native API delivery and API/jobs readiness require valid simulated-inbox configuration; both HTTP transports accept the full ten-file/64 KiB-per-file importer reservation, including worst-case JSON escaping, while unrelated JSON commands retain the 64 KiB limit. No schema, credential or real-provider changes were needed.
- Added native configuration/streaming-limit regressions and two opt-in hosted v2 browser journeys. Authentication/network traces, video and automatic screenshots stay disabled; selected synthetic screenshots and bounded status/method/normalized-path diagnostics are retained without session or response bodies.

Validation record — October 8, 2026:

**Final result:** both hosted v2 journeys pass together on `75b1f96` (**2/2 desktop**, 7.1 minutes including deliberate pacing), with four earlier inbox cases also passing (**six distinct hosted cases**). Final report: `.local/hosted-v2/final-report.json`; screenshots: `.local/hosted-v2/final-artifacts/`. The repeated scope case proves the corrected release preserves stale-address fencing, refresh replay and unrelated-applicant denials. Its diagnostic HTTP failures are the four intended 404s; no 429/5xx occurred. All required V2-08 criteria are verified.

- **Local corrections:** `pnpm check` passes **419 unit tests across 40 files**, Biome, browser boundaries, root TypeScript and all **12 workspace typechecks**. `pnpm test:integration` passes **483 PostgreSQL cases across 50 files** at `7a97243`; after the queue correction the full suite passes **484/484**, with **419/419** unit regressions again passing. `KEYCADE_DEPLOYMENT=cloudflare pnpm build` passes all **12 builds**; all **five Wrangler deployment dry runs** pass. The existing installed Node 24.21.0/pnpm 10.34.6 executable was used after the global launcher could not verify its registry signature; no lockfile/dependency changes were made. Logs are under `.local/hosted-v2/{check,integration,build}.log`, `{unit,integration}-final.log` and `dry-run-*.log`. Queue correction also passes worker/root TypeScript, scoped Biome, browser boundaries and the final jobs dry run.
- **Migrations:** GitHub run [37827143074](https://github.com/igoramidzic/keycade/actions/runs/37827143074) applied migration 0024 (**one applied, 25 total**). Repeat run [37830884543](https://github.com/igoramidzic/keycade/actions/runs/37830884543) on `ab7ed19` passed (**zero applied, 25 total**). Read-only before/after counts and identity hashes match for the existing bank, 11 users, eight applications, ten documents and one funded account. Files: `.local/hosted-v2/before-migration.json` and `after-migration.json`; neither contains record values or credentials. V2-07 owns the broader populated-baseline upgrade proof.
- **Native deployment:** all five builds succeeded at application revision `7a97243627744e6b215c7680feecbbaeb4b01c4d`: API `4bb5d6b1-e196-408a-a485-edfca1a9c487`, jobs `54681949-8268-4ac5-81f4-e9123c05c880`, bank site `389b28c0-e311-4aae-b8e2-34719f826533`, borrower `c555b4eb-1180-4a15-8f65-71c65b295e36`, console `6988d124-07e1-4294-8a72-cd20da60cac1`.
- **Queue-corrected deployment:** all five native builds succeeded at `75b1f96f916c3f0eaac3e9104f1596d21d4c05d9`: API `1b0840c6-df78-46cc-b4df-d47e68e7ac5a`, jobs `0404359c-f83b-4bce-b935-466ca70149f1`, bank site `744cab89-7c74-4142-883a-961206fdd61c`, borrower `3aa316dc-fe03-48ed-b7b1-b44059fb0387`, console `43284208-afc8-4d5c-83b7-ae623304b76e`. All four public readiness endpoints returned 200 after deployment.
- **Bindings/readiness:** frontend `API`/`ASSETS`, API `HYPERDRIVE`/`JOBS`/rate limiter/R2, and jobs `HYPERDRIVE`/Queue/R2 read back correctly. Both private inbox flags are true; encryption secrets are present without reading their values. Jobs retain two-second simulation delay, one-message batches, three retries and minute recovery Cron. Every public same-origin `/api/ready` reports database/worker ready and `simulation: true` after deployment.
- **Hosted inbox:** all **four desktop cases** passed on `ab7ed19`: deliberate confirmation, used-link concealment/logout access, fresh-link setup resume, known staff and unknown-staff denial. Report `.local/hosted-v2/inbox-report.json`.
- **Hosted revision/access:** the instrumented `hosted-v2.spec.ts --grep 'address changes'` case passed on `7a97243`: officer-prefilled unfinished setup, US-to-Canada revision invalidation, removal of old pin/clear result, simulated non-US outcome, one refresh successor under replay, and unrelated-applicant 404 denials for setup/documents/financial facts/checks without resource leakage. Report `.local/hosted-v2/scope-report.json`; visually inspected screenshot under `scope-artifacts/`.
- **Hosted document journey:** the final expanded setup/resume/masking, tabless borrower layout, four registered imports, exact private R2 download bytes for three tax PDFs, queued analysis, six explicitly reviewed financial facts across 2023–2025 and US Loan Footprint all passed on `75b1f96` (4.4 minutes including deliberate test pacing). The scenario-kit, document modal, financial-history and footprint screenshots under `.local/hosted-v2/final-artifacts/` were visually inspected. An earlier four-document batch exposed native queue under-draining: the scan family handled up to five documents but woke interpretation once, and interpretation handled only one run. Remaining files waited for successive minute Cron invocations and exceeded the 120-second browser expectation. The correction now drains at most five due items and continues only a full batch. A native PostgreSQL regression passes ten documents after an early processing wake without Cron, exactly one attempt/effect each, duplicate delivery protection and no future-work queue spin; the corrected hosted document journey passed. The initial mask assertion falsely matched registered bank/product UUID digits; it now inspects scalar fields and exempts only valid UUIDs at known ID paths. The earlier scope run stopped on an uninstrumented session-check failure; its instrumented rerun passed, with only expected denied reads and navigation-aborted requests. These initial failed attempts are retained in `.local/hosted-v2/v2-report.json` and are not counted as passes.

Actual hosted URLs: [mock bank](https://keycade-bank-site.kualia.workers.dev), [borrower](https://keycade-borrower.kualia.workers.dev), [lender console](https://keycade-bank-console.kualia.workers.dev), and [API readiness](https://keycade-api.kualia.workers.dev/api/ready). Jobs have no public URL. All actions use new synthetic records and simulated providers. Local V2-07 remains the broader desktop/mobile, negative, legacy-upgrade, review/signature/funding proof; the hosted slice is deliberately smaller. Disabled-delivery errors are tested through the native entrypoint without disrupting hosted inbox configuration. Separate CI validation remains paused.

## Planning validation

Completed October 8, 2026, for documentation only:

- Visually inspected all twelve user-supplied HEIC images using temporary local converted copies; source-to-requirement traceability is recorded in the findings document. No source photographs or visible personal/financial identifiers were added to fixtures.
- Cross-checked the existing setup, borrower/lender navigation, encrypted identifiers, document interpretation and D05 fixture contracts. Updated the main index, core references, decision log, requirement map and affected task amendments while preserving their historical validation records.
- Independent consistency review resolved V2-04's initial dependency on V2-05's grouping UI, separated US eligibility from coordinate availability, and replaced the obsolete production-demo rejection policy with the established D03 rule.
- A local Markdown path/heading validator checked **246 links across 43 planning documents**, with **zero errors**. Task dependency review found no cycles; V2-01 is the next default task and V2-03 can proceed independently. All eight tasks remain Not started with Not run implementation validation.
- `git diff --check` passed. No application code or schema changed; application builds, runtime tests and deployment were not run for this documentation-only request.

## Website entry and focused question — October 8, 2026

The user reported that a bare domain was rejected and questioned the NAICS summary under Website. The shared website contract now accepts domains without a scheme, normalizes them to HTTPS, and retains HTTP/HTTPS-only, no-credentials and length validation. The website screen no longer repeats industry/NAICS; the dedicated industry question, final review and business summaries retain that saved answer. Back still saves and returns to industry. This supersedes V2-01’s earlier website-step industry-summary requirement; dependencies and persisted schema are unchanged.

Acceptance: bare domains advance and persist canonically across resume; invalid URLs still fail without erasing input; industry choices remain saved and editable, and the website screen shows no repeated classification.

Done locally — October 8, 2026. Validation:

- `node_modules/.bin/vitest run packages/contracts --exclude '**/*.integration.test.ts'`: 81 contract tests pass, including kualia.com, www, paths/queries, ports, explicit HTTP/HTTPS, idempotent normalization and rejected malformed/credential URLs.
- Targeted `setup.integration.test.ts` persistence case (keeps address revisions, normalized websites…): 1 PostgreSQL case passes; 32 unrelated cases intentionally filtered. The case now supplies a bare uppercase domain directly to the service and checks canonical persistence and explicit clear.
- `node_modules/.bin/tsx scripts/e2e.ts tests/e2e/industry.spec.ts tests/e2e/intake.spec.ts --grep 'industry search|optional EIN, website'`: 6 isolated desktop/mobile cases pass, no skips/failures/flaky cases. Covers invalid URL correction to a bare domain, save/resume/clear, absence of the website-step industry row, Back to industry with website preservation, saved industry selection/clear and keyboard search/retry.
- Contracts and borrower typechecks pass; borrower Vite production build passes with the existing large-chunk warning. Biome passes for the six changed source/test files; `git diff --check` passes.

No schema migration or hosted deployment was performed.

## Whole-dollar amounts and addressable setup steps — October 8, 2026

The user asked for a currency display with comma separators and whole numbers when entering a requested amount, for each setup step to be its own page that can be reloaded, and for each new step to scroll to the top.

- The setup amount question and the staff prefill form use the shared `CurrencyInput`: a `$` prefix, thousands separators while typing, a caret that stays with the typed digits, and whole dollars only (cents and other characters are ignored). The contract still stores two-decimal USD strings, product limits are still validated, and a saved `42000.00` reopens as `42,000`.
- Each setup question has its own route, `/applications/:id/setup/<step>` (`business-name`, `business-address`, `business-ein`, `industry`, `website`, `amount`, `purpose`, `other-purpose`, `review`). `/setup` and application deep links open the saved step. Continue, Back, Skip and Edit add a history entry for the new step.
- Reload keeps the current question. Browser back/forward and typed step addresses save the move as an edit only to questions already reached (earlier questions, answered or skipped questions, or the first question after settled ones); anything else, or a failed move, returns to the saved step. Unsaved answers stay in the existing per-tab recovery cache; unsaved EIN values still never persist.
- Every step change scrolls to the top and focuses the question heading without a second scroll. Sign-in recovery still returns to `/setup`, which reopens the saved step, so return-path validation is unchanged.

Acceptance: formatted whole-dollar entry and persistence; per-step URLs through the whole wizard; reload, back/forward and unreached-step redirects; focus and scroll position on step changes; existing setup, intake, resume and officer-handoff journeys.

Done locally — October 8, 2026. Validation (shared with the other October 8 UI follow-ups in this change):

- `pnpm lint` (Biome and browser/server boundaries), root `tsc --noEmit` including `tests/`, and the shared UI, bank-console, borrower and bank-site typechecks pass. `pnpm test`: **425 unit tests** pass. All three web Vite builds pass (existing large-chunk warnings remain).
- `pnpm test:e2e` with `participants`, `collaborator-upload`, `staff-workspace`, `borrower-workspace`, `intake`, `demo-inbox` and `lender-overview-v2` (`.local/e2e-utpAIY`): **74 desktop/mobile cases — 65 passed, 8 skipped, 1 failed, 0 flaky**. The skips are the eight `demo-inbox` cases, which run only when `DEMO_INBOX_ENABLED=true`. The failure was the mobile *queue loading and service failure* case: by then the combined run had created 55 applications, pushing the seeded Synthetic Cedar Workshop off the first queue page. Rerun alone, it passed on desktop and mobile (2/2, `.local/e2e-ouo2wc`).
- Browser inspection against the local stack at 1280px and 375px (no horizontal overflow). Intake, borrower-workspace and staff handoff journeys now assert step URLs (`/setup/purpose`, `/setup/review`, `/setup/amount`, `/setup/business-name`) and comma-formatted whole-dollar values (`42,000`, `37,500`, `12,345`, `7,500,001`). In a fresh synthetic draft, the following were checked by hand: every step URL; Continue, browser Back and Forward; reload; a typed unreached `/setup/review` returning to the saved step; scroll position 0 with heading focus after each step; and the caret staying in place mid-number edits (`12,505,000`). The updated `/setup/amount` assertions in `demo-inbox.spec.ts` (opt-in) and `hosted-demo.spec.ts` (hosted-only) were not run. No schema migration or hosted deployment was performed.
