# V2 delivery and validation

Planning date: October 8, 2026. V2-01 is complete locally; the remaining tasks are **Not started**. Only the task-specific evidence below proves v2 behavior.

Read [the experience specification](02-experience-spec.md) and [the data and simulation specification](03-data-and-simulation.md) before implementing a task. The [main plan](../README.md), [architecture](../02-architecture.md), [access rules](../03-domain-and-access.md), and [verification discipline](../05-development-and-testing.md) still apply. Implement one bounded task or reviewable slice at a time.

## Sequence

| ID | Deliverable | V2 dependencies | Existing prerequisites | Status |
| --- | --- | --- | --- | --- |
| V2-01 | Expanded resumable intake | — | T07, T08, T15 | Done — local acceptance below |
| V2-02 | Borrower task dashboard without top tabs | V2-01 | T09, T11–T13, T17–T21, D05 | Not started |
| V2-03 | Protected text-to-fixture demo importer | — | T13, T14, D05 | Not started |
| V2-04 | Document review and confirmed financial facts | V2-01, V2-03 | T14, T15, T19 | Not started |
| V2-05 | Lender application overview and evidence drill-down | V2-01, V2-04 | T10, T12, T16, T19, T21 | Not started |
| V2-06 | Simulated Loan Footprint | V2-01 | T16 | Not started |
| V2-07 | Integrated local acceptance | V2-02, V2-03, V2-04, V2-05, V2-06 | T22 | Not started |
| V2-08 | Hosted parity and deployment acceptance | V2-07 | D02, D03 | Not started |

Existing prerequisites are recorded as complete in the main plan. D05 and some later follow-ups have only local evidence; V2-08 must carry the combined implementation through hosted validation. V2-01 and V2-03 can proceed independently. V2-06 can be implemented and demonstrated from the existing lender Checks view before V2-05 adds its overview entry point.

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
- Retain email-first access, one simple question per screen, server-saved Back/Continue/Skip progress, review/correction and explicit completion. Present the selected NAICS code and title with website/business details; it is a classification code, not a numeric score.
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

Implementation record: **Not started.**

Validation record: **Not run.** No borrower navigation or layout change is claimed.

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

Implementation record: **Not started.**

Validation record: **Not run.** D05's existing evidence does not cover the new importer.

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
5. Browser checks cover desktop split view, mobile layout, keyboard open/close and focus return, loading/failed preview, analysis selection and explicit financial confirmation. No real OCR provider is called.

Implementation record: **Not started.**

Validation record: **Not run.** Existing extraction suggestions are not confirmed financial facts.

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

Implementation record: **Not started.**

Validation record: **Not run.** Existing lender tabs and queue are baseline functionality only.

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

Implementation record: **Not started.**

Validation record: **Not run.** A map illustration alone is not geographic-result acceptance.

## V2-07 — Integrated local acceptance

Dependencies: V2-02–V2-06; T22. Primary areas: focused integration/browser journeys, demo instructions and validation record.

### Scope and acceptance

1. Run a new synthetic borrower from email-first setup through resume, illustrated purposes, tabless dashboard, text fixture import, delayed processing, lender grouped documents, modal review, confirmed metrics and Loan Footprint. Verify the existing human review/signature/closing/simulated-funding journey remains usable.
2. Exercise incomplete and completed legacy applications, staff prefill/handoff, another business/application, restricted adviser and revoked participant. Validate direct API denials as well as UI states, including private document/metric aggregate leakage and stale evidence/address results.
3. Verify clean migrations and an upgrade containing legacy records on real PostgreSQL; repeat ordinary initialization without data loss. Inject job retries/restarts and revision conflicts without duplicating business effects.
4. Run affected unit/HTTP/real-PostgreSQL suites, both local transport adapters, `pnpm check`, `pnpm build`, and desktop/mobile browser journeys. Visually inspect the dashboard, scenario kit and modals; check keyboard focus and no overlap/overflow.
5. Record the tested revision, commands, actual results and any limits. Update the demo guide and requirement map; do not claim hosted completion or re-enable paused CI without separate direction.

Implementation record: **Not started.**

Validation record: **Not run.** Local acceptance must name the combined tested revision.

## V2-08 — Hosted parity and deployment slice

Dependencies: V2-07; D02 and D03, including deployed simulation/authentication configuration. Primary areas: existing five-Worker deployment, committed migrations, R2/queue adapters and hosted browser acceptance.

### Scope and acceptance

1. Carry the combined v2 implementation and required prior local-only follow-ups through the existing deployment process. Apply additive committed migrations through the established migration workflow; verify repeat no-op behavior and retain existing hosted synthetic records.
2. Verify all five native Worker builds and required bindings/configuration. Keep authentication and email simulated and retain D03's `AUTH_DELIVERY_UNAVAILABLE` recovery behavior; no environment may enable real services implicitly.
3. On actual hosted URLs, use new synthetic records to demonstrate setup/resume, optional EIN masking, borrower layout, text import, real R2 byte upload/download, queue processing, lender document review/confirmed metrics and address-bound Loan Footprint.
4. Exercise at least one scoped denial and a stale/retry case through hosted adapters. Record actual URLs, deployed revision, migration result, browser report and simulation labels without tokens, raw identifiers or private evidence.
5. Distinguish full local negative coverage from the smaller hosted slice. Deployment/build success alone cannot close this task; remaining hosted failures or unverified criteria stay explicit in the task/index.

Implementation record: **Not started.**

Validation record: **Not run.** No v2 deployment or hosted acceptance is claimed.

## Planning validation

Completed October 8, 2026, for documentation only:

- Visually inspected all twelve user-supplied HEIC images using temporary local converted copies; source-to-requirement traceability is recorded in the findings document. No source photographs or visible personal/financial identifiers were added to fixtures.
- Cross-checked the existing setup, borrower/lender navigation, encrypted identifiers, document interpretation and D05 fixture contracts. Updated the main index, core references, decision log, requirement map and affected task amendments while preserving their historical validation records.
- Independent consistency review resolved V2-04's initial dependency on V2-05's grouping UI, separated US eligibility from coordinate availability, and replaced the obsolete production-demo rejection policy with the established D03 rule.
- A local Markdown path/heading validator checked **246 links across 43 planning documents**, with **zero errors**. Task dependency review found no cycles; V2-01 is the next default task and V2-03 can proceed independently. All eight tasks remain Not started with Not run implementation validation.
- `git diff --check` passed. No application code or schema changed; application builds, runtime tests and deployment were not run for this documentation-only request.
