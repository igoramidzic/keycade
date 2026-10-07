# T07 — Application creation and resumable setup state

Dependencies: T06. Read [product journey](../01-product.md) and [lifecycle](../03-domain-and-access.md).

## Outcome

One backend use case creates and updates applications from both borrower and staff entry points, persists initial setup progress, and enforces completion before applicant portal workflows.

## Scope

- Implement restricted public email-start: validate public bank/product, create pending contact/draft, and queue a continuation link in one durable workflow.
- Implement staff creation on behalf of a borrower through the same creation service; record source, actor, bank, contact, and optional existing authorized business. Accept optional initial business name, exact amount and purpose, validate them against the pinned product, and persist them with the new draft and continuation intent in one transaction.
- On email verification, bind the selected intended draft/contact to the verified identity and appropriate participant role. Fresh generic resume lists existing grants and pending drafts addressed to that verified email within the selected bank; selecting one claims it idempotently without accepting unrelated invitations. Never merge businesses on name or supplied identifiers alone.
- Honor the user's [local demo sign-in override](../06-decisions-and-sources.md#immediate-demo-sign-in-october-6-2026): allow a T06 demo actor to start/resume only synthetic drafts in its selected demo bank, without requiring email delivery. Record demo provenance; do not stamp mailbox verification or weaken the non-demo verification/claim path.
- Add get/list/draft-patch services with decimal-string amounts, configurable product limits, optional industry, autosave revisions, and stable pagination. Generic draft DTOs reject raw EIN/SSN fields; private collection comes through T15/T16.
- Add a committed migration for per-application setup state: step-definition version, current step, completed/skipped step keys, optimistic revision, and completion actor/time. Save canonical answers and step progress in one transaction and return a safe authorized resume summary.
- Add an explicit, revision-checked, idempotent finish-setup command for the applicant administrator. Validate required initial answers and atomically record completion, audit/job intent, and the `draft` → `collecting_information` transition. Staff can prefill answers but cannot bypass applicant confirmation.
- Provide shared backend guards for applicant portal operations and a safe next-destination result. Incomplete setups allow minimal selection summaries and setup access; direct portal requests cannot bypass the gate. Preserve staff draft access and scoped collaborator authorization.
- Use request idempotency records scoped to operation/actor or a secure public-start request context; handle same-key payload conflicts.

## Acceptance criteria

- Entering email creates a pending profile/draft before additional information; the response grants no access to existing records.
- Borrower and staff creation obey the same invariants and expose their source in audit/history.
- Concurrent retries return one logical application; an intentional new key creates another application even for the same business.
- $10k, $5m, and $7.5m are represented exactly where allowed by product configuration.
- Initial details can omit EIN, SSN, and NAICS. A saved step is restored after a new session, including when the original link expired or the browser state was lost. Several pending drafts for one email can be distinguished after verification; resume creates no duplicate application.
- Unauthorized edits and conflicting revisions fail without partial writes or lost updates.
- Answers and current/completed/skipped steps survive session/device changes. A failed save changes neither the stored answers nor progress; a dependent answer change invalidates affected step validation.
- Missing required answers, stale revisions, unauthorized actors, client-supplied completion flags, and direct applicant portal calls cannot bypass setup. Repeating a successful completion returns one completion and lifecycle transition without duplicate effects.
- Creation and staff prefill leave setup incomplete. Only explicit applicant completion unlocks the portal, including for a permitted local synthetic demo actor. Completing application A does not complete application B or grant anyone access.
- Staff creation accepts email alone or partial initial details. Invalid initial details leave no application, setup, contact, audit, idempotency or delivery intent from that attempt; corrected input can retry. Replaying a valid creation payload produces one application and continuation, and a conflicting payload with the same key is rejected. See the [T10 officer handoff follow-up](T10-bank-workspace.md#officer-started-application-handoff--october-7-2026) for validation.
- Setup completion does not submit, approve, fund, or satisfy later evidence/check requirements.
- The local demo can create/resume synthetic drafts after immediate email entry; demo actors cannot claim drafts in another bank or non-synthetic data.

## Validation

Test both entry points, public-start rate limiting, generic responses, transaction rollback, concurrent idempotency, duplicate-email behavior, money bounds, tenant isolation, and revision conflicts with real PostgreSQL. Cover answer/progress atomicity, optional skips, resume without browser state, staff-prefilled drafts, completion retries/races, per-application isolation, and setup guards through both HTTP transports. Exercise T06's allowed local demo actor as well as the email-link actor.

Keep the creation service callable by a future authenticated bank integration; do not build a public partner API or SSO yet.

## Implementation record

Implemented October 7, 2026. Final validation is recorded below.

- Shared application service covers public email-start, authenticated borrower/demo and staff creation, minimal lists, explicit pending-draft claim, setup reads/saves/completion, and destination resolution. New routes are available in Fastify and the native Worker transport and described by OpenAPI.
- Migration `0004_mysterious_black_knight.sql` adds application answers/provenance, per-application setup, request deduplication, and targeted access delivery. Fresh migrations and an upgrade from 0000–0003 preserve historical drafts, lifecycle state, amounts, names, and revisions; repeat migration is a no-op.
- Backend guards protect existing application reads/purpose writes and future task/document policies. Staff retains draft access; scoped collaborators retain their separate journey. Completion creates neither submission nor provider/check outcomes.
- See [implementation choices](../06-decisions-and-sources.md#application-setup-backend--october-7-2026) for public keys, cursor order, historical migration policy, and completion's lack of a background effect at this milestone.

### API handoff

All authenticated routes require the current session's bank, current authorization, and CSRF proof for writes. `bankId` and `applicationId` below are UUIDs.

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/applications/start` | Public email/bank slug and optional product slug; 64-character random hexadecimal request key; generic acknowledgment and durable continuation intent. |
| `GET /api/v1/banks/:bankId/applications` | Minimal authorized and claimable summaries; optional `after` UUID and `limit` (1–100). |
| `POST /api/v1/banks/:bankId/applications` | Authenticated create; UUID request key, optional product, staff recipient email/authorized business. |
| `POST /api/v1/banks/:bankId/applications/:applicationId/claim` | Explicit eligible pending-contact claim; empty object body. |
| `GET /api/v1/banks/:bankId/applications/:applicationId/setup` | Authorized answers and persisted setup progress. |
| `PATCH /api/v1/banks/:bankId/applications/:applicationId/setup` | Revision-checked strict `answers`, `currentStep`, optional validated `step`/`skip`. |
| `POST /api/v1/banks/:bankId/applications/:applicationId/setup/finish` | Explicit applicant confirmation with expected revision and UUID request key. |
| `GET /api/v1/banks/:bankId/applications/:applicationId/destination` | Safe `setup`, `portal`, `assigned`, or `closed` result from current server state. |

`SETUP_REQUIRED` blocks premature applicant portal access; `REVISION_CONFLICT` requires reloading current saved state; `IDEMPOTENCY_CONFLICT` rejects reuse with changed input. General draft DTOs reject EIN/SSN, lifecycle, permission, and completion fields. Amounts are decimal strings with exactly two fractional digits. Industry code and taxonomy version are supplied together or explicitly skipped.

### Validation

Validation used the installed Node 24.21.0 and repository binaries directly because the host pnpm launcher attempted package-manager registry verification and stalled in this environment; no dependency or lockfile change was needed. Normal repository commands remain `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and `pnpm build`.

- `node_modules/node/bin/node node_modules/@biomejs/biome/bin/biome check .`, browser boundary script, root TypeScript, and each workspace's typecheck/build script: passed.
- `node_modules/node/bin/node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts'`: 129 tests passed.
- PostgreSQL integration runner (the same owned-local-target checks and `vitest run .integration.test.ts` as `pnpm test:integration`): 114 tests passed across 13 files. Includes 25 T07 domain tests, six HTTP journeys covering both transports, database constraints, historical upgrade, identity, and durable jobs. A prior queue-test clock race was corrected by setting its retry fixture explicitly in the past; no queue runtime behavior changed.
- After the final closed-application guard, the focused domain + HTTP suites passed again: 31 tests; domain/API types remained clean. Final Biome, `git diff --check`, and plan Markdown path checks passed.
- `node_modules/node/bin/node --import tsx scripts/local.ts db:migrate` and `db:status`: local migration applied; authenticated query and readiness passed without reset.
- Wrangler 4.148.0 API `deploy --dry-run`: bundled successfully. This is a local bundle check, not a hosted compatibility/deployment claim.

Wizard UI, borrower dashboard, staff screens, invitation workflows, and evidence/check tasks remain their owning tasks. T07 acceptance is demonstrated through real PostgreSQL service/HTTP tests; browser wizard journeys begin in T08.

### Fixed-product override — October 7, 2026

The subsequent [T08 fixed-product decision](T08-intake.md#fixed-product--october-7-2026) supersedes selectable/changing products. Creation assigns the latest active Synthetic Business Credit version for the bank; callers cannot choose another product. Setup rejects changing an assigned ID. Legacy same-ID prefills remain compatible, and legacy product navigation resolves to amount. Migration 0005 safely updates eligible unfinished drafts. The product/version model and configured monetary limits remain in use.
