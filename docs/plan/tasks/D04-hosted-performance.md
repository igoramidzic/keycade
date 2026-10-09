# D04 — Hosted request efficiency and latency

Dependencies: D02, D03, T12, T16. Read [architecture](../02-architecture.md), [access rules](../03-domain-and-access.md), and [development/testing](../05-development-and-testing.md).

Status: Done — October 7, 2026. Request-efficiency, session-binding and placement changes passed local validation, and serial/concurrent production reads were repeated after deployment. The [hosted remeasurement](#hosted-remeasurement--october-7-2026) records the different-fixture limitation and remaining concurrent review latency.

## User request and bounded change

Investigate several-second startup/task/readiness loads, slower saves, and repeating session/resource requests in the deployed synthetic demo. Reduce unnecessary requests while retaining server-side identity, bank, participation, private-resource and workflow checks. No real external services, financial operations, new infrastructure or schema change is needed.

## Acceptance criteria

- Protected browser reads/writes use one resource request, with server-validated binding to the workspace's session; an identity change or revoked session is denied. Late responses after a local identity change cannot populate a different account's workspace.
- Idle document, check, readiness and review reads use a 30-second collaboration refresh. Current uploaded documents undergoing scan/interpretation and actively executing checks retain three-second updates. Historical/stale runs and checks waiting for human input do not trigger fast polling. An error stops timer retries until explicit retry/focus/mutation invalidation.
- Task saves and the existing conflict, navigation, private-access and revocation regressions remain correct. Existing mutation-driven invalidation remains authoritative for local edits.
- Configure API placement near the existing Neon AWS Ohio database and publish safe response timing/log metadata. Keep Hyperdrive query caching disabled; do not cache authorization on the server.
- Verify the native Worker bundle and record local type/lint/build, unit, PostgreSQL, and desktop/mobile request-count checks.
- After a requested deployment, repeat production serial/concurrent reads and report actual before/after timings. Verified in the hosted remeasurement below.

## Production diagnosis — October 7

An authenticated synthetic borrower with eight visible tasks reproduced the slowdown. Three serial samples per endpoint, followed by one concurrent batch, produced:

| Read | Serial elapsed time | Concurrent elapsed time |
| --- | --- | --- |
| Session | 155–160 ms | Not sampled |
| Application portal | 1,542–1,935 ms | Not sampled |
| Tasks | 1,827–1,842 ms | 3,750 ms |
| Documents | 707–723 ms | 6,029 ms |
| Readiness | 1,998–2,803 ms | 5,547 ms |
| Review | 2,141–3,788 ms | 2,151 ms |

These are end-to-end HTTP measurements from this host, not server CPU times or a statistical percentile. The private audit script is `.local/latency-audit.mjs`; it keeps credentials/cookies in memory and prints only aggregate timings/counts. The Neon diagnostic used `BEGIN READ ONLY`: three warm `SELECT 1` round trips measured 52–53 ms; the activity snapshot showed one active diagnostic connection and five idle connections, with no observed lock waits. A point-in-time snapshot does not exclude contention during the concurrent API batch.

Cloudflare read-back confirms Hyperdrive targets Neon in `us-east-2` with query caching disabled. Observability is enabled but invocation logs are disabled; the account telemetry search returned no usable Keycade request timings. Existing warning-only logs cannot provide a historical route-latency breakdown.

The source explains the request amplification: borrower and staff clients fetched `/auth/session` before and after every protected resource read/write. Thus each apparent fetch involved three serial HTTP calls. Documents/readiness polled every three seconds, review every five seconds, tasks every 15 seconds, and portal every 30 seconds. The former overview could schedule roughly 174 HTTP requests/minute before manual edits/focus/startup, exceeding its 120/minute API budget. This is calculated from the source intervals, not a measured rate-limit incident. Task/readiness/review/portal reads reconcile requirements under the application lock and execute many sequential SQL statements, so overlapping polls increase contention. Extra browser threads cannot remove those database round trips or locks.

## Implementation

- IdentityPortal remembers only its in-memory session snapshot. Browser clients send `x-keycade-session` using that session's verification token instead of performing two session fetches per request. Both Fastify and Workers resolve the actual cookie, compare the optional binding using the existing constant-time verification, then run ordinary authorization. The header cannot establish identity. Old clients without it still use the existing cookie/CSRF rules.
- Browser clients discard successful responses if the local session changed while loading. Staff denial continues to clear its QueryClient and refresh identity. Initial sign-in, explicit session refresh and file-transfer verification retain their deliberate session checks.
- A validated API response confirms binding with `x-keycade-session-bound: 1`. Because the five native builds finish independently, clients retain an explicit session post-check only when an older API does not confirm binding. Mixed-version rollout cannot silently disable account-switch protection; the one-request path applies as soon as the new API is serving.
- Current-only processing state determines the fast/idle refresh policy. Readiness and review switch to fast refresh only for queued/running/retrying checks. Timer retries stop on errors, including access denial.
- Session resolution joins the active bank membership in the original session query, eliminating another SQL round trip while preserving immediate staff revocation.
- API configuration specifies `placement.region = aws:us-east-2`. This is supported by the installed Wrangler schema and current [Cloudflare placement documentation](https://developers.cloudflare.com/workers/configuration/placement/). Only the API fetch runtime is affected; queue/Cron placement is not claimed.
- Hosted responses expose `Server-Timing: api;dur=...`. Structured logs contain only resource category, method, status and duration; no raw URL/query, session/CSRF value, identity, or document content is logged. Local logger redaction covers both verification headers.
- Concurrent workspace work removed the overview's hidden review fetch used only to decide navigation visibility. Those changes were preserved; the overview now uses the authorized portal capability and its separate scoped readiness read.

## Validation

- `pnpm typecheck`, `pnpm lint` (331 files plus browser boundaries), and `pnpm build`: pass across all 12 packages and root types. Existing frontend bundle-size notices remain; they do not explain the measured protected API delays.
- Initial unit checkpoint: 278 tests passed. The nine new focused borrower/staff request and refresh-policy tests pass; final whole-suite checkpoint is recorded below.
- `pnpm test:integration`: 350 tests in 39 real PostgreSQL suites pass. The two new transport cases cover bound reads, same-bank account changes, mismatched writes, anonymous binding attempts, logout and immediate revocation. Existing identity tests cover active membership revocation.
- Desktop navigation/account-switch/save/conflict regression subset: 12/12 existing cases pass in `.local/e2e-H1vaxn`. The first request-count assertion counted an extra aborted React development StrictMode mount fetch; the final test counts completed responses and still asserts no new idle responses through 12 seconds. Final desktop/mobile results follow below.
- The original diagnostic validation preceded deployment. After-change production timings are recorded below for deployed checkpoint `d7a6597`.

### Final local checkpoint

- Full unit suite: **283/283 pass** in 25 files, including 11 new focused request/refresh tests and older-API rollout protection.
- Both final PostgreSQL identity transport suites: **8/8 pass**, including the server response binding marker. The complete PostgreSQL checkpoint above remains **350/350 pass**; the final marker-only addition was rechecked in the affected suite.
- Desktop navigation/account-switch coverage: nine existing cases pass in `.local/e2e-H1vaxn`; final borrower/staff save-conflict and stale-answer cases plus desktop idle-network acceptance pass **4/4** in `.local/e2e-hPXyYc`. Final mobile idle-network acceptance passes **1/1** in `.local/e2e-dcZRfp`. The combined selected coverage is 14 applicable cases with no outstanding failures.
- The idle-network test observes one completed session read, one tasks/documents/readiness read each, no hidden review request, and no further completed resource/session responses through 12 seconds of browser clock advancement. This verifies request reduction without promising a production latency threshold.
- Final types, lint/boundaries, all 12 builds, `git diff --check`, and native API deployment dry run pass. Native bundle evidence is under `apps/api/.local/d04-api-dryrun`; the dry run uploads nothing and verifies placement/bindings. No migrations were introduced.

### Hosted remeasurement — October 7, 2026

After checkpoint `d7a6597` deployed, the production borrower API was measured at **20:33:35 UTC** with the original request sequence: three serial samples for each of six endpoints, then one concurrent batch of tasks/documents/readiness/review. All **22 protected reads returned 200**, and every response included `Server-Timing: api;dur=...`. The only explicit write was ordinary demo-session sign-in; application reads retained their normal authorized requirement reconciliation. Credentials and cookies stayed in memory, and no business command, identifier entry, external provider or financial action was performed by the benchmark.

The original audit did not retain its fixture ID. This run therefore pinned the application created by this implementation chat's hosted enrichment test: a synthetic $10,000 application with completed setup and status `collecting_information`, **seven visible open tasks**, zero documents, one active fraud check with one current succeeded run and three stale cancelled runs, and no signature envelopes. The baseline had **eight visible tasks**; its other workload counts were not retained. These are comparable endpoint observations on different fixtures, not a controlled same-fixture comparison or proof that a particular change caused the difference.

| Read | Baseline serial HTTP | Deployed serial HTTP | Deployed API duration |
| --- | --- | --- | --- |
| Session | 155–160 ms | 127–138 ms | 20–27 ms |
| Application portal | 1,542–1,935 ms | 567–651 ms | 441–512 ms |
| Tasks | 1,827–1,842 ms | 867–896 ms | 691–736 ms |
| Documents | 707–723 ms | 325–366 ms | 217–236 ms |
| Readiness | 1,998–2,803 ms | 753–1,096 ms | 614–745 ms |
| Review | 2,141–3,788 ms | 870–935 ms | 725–760 ms |

| Concurrent read | Baseline HTTP | Deployed HTTP | Deployed API duration |
| --- | --- | --- | --- |
| Tasks | 3,750 ms | 1,046 ms | 889 ms |
| Documents | 6,029 ms | 305 ms | 188 ms |
| Readiness | 5,547 ms | 1,638 ms | 1,264 ms |
| Review | 2,151 ms | 2,382 ms | 2,215 ms |

All serial ranges were lower in this run. Concurrent review remained over two seconds and was slightly higher than its baseline sample, so the evidence does not claim that every request became faster. Shared application locking and sequential authorization/reconciliation queries remain; the measured concurrent readiness/review durations are consistent with that serialization. Server-Timing reports the API handler's elapsed duration, not CPU time. These few samples from one host establish neither latency percentiles nor a general service-level guarantee.

The direct Neon diagnostic remained `BEGIN READ ONLY`: three warm `SELECT 1` round trips took **48–49 ms**, versus 52–53 ms previously. The point-in-time activity snapshot again showed one active diagnostic connection and five idle connections, with no observed lock wait. Safe aggregate timings and workload counts are in `.local/d04-latency-recheck.json`; the pinned private wrapper is `.local/d04-latency-recheck.mjs`. Neither file contains database credentials, session values, response bodies or applicant identities. No hosted browser run overlapped this benchmark.

## Lender queue and focus refresh — October 9, 2026

Status: Done locally — live diagnosis, implementation and local acceptance verified. Publication and post-deployment HTTP remeasurement remain pending.

The user reported a roughly seven-second lender applications list and recurring full-page spinners around `/options` and `/accounts`. This follow-up keeps D04's dependencies and all backend session, bank, application and resource guards.

### Live evidence

Cloudflare telemetry for the deployed API version `aed3c796-d41d-4a5c-9e97-a6d8f65b9cf1` showed three application-list requests at **7,568, 7,907 and 7,567 ms**. Recent options requests were usually **123–174 ms**, with observed slower samples up to **1,107 ms**. Accounts were usually **117–161 ms**, with an overlapping-work sample at **3,534 ms**. These are observed handler durations, not CPU times or population percentiles.

A separate authenticated probe using the existing synthetic officer account reproduced the issue on the same **17 applications**:

| Endpoint | Three serial HTTP samples (ms) | Concurrent HTTP sample (ms) |
| --- | --- | --- |
| Staff applications | 7,035 / 7,515 / 8,330 | 8,571 |
| Staff options | 272 / 274 / 1,113 | 646 |
| Funded accounts | 240 / 255 / 239 | 277 |

Application API handler durations were 6,864 / 7,155 / 8,128 ms serially and 8,394 ms in the concurrent batch. Most of the delay was inside the API. Cloudflare read-back confirmed targeted API placement, Neon in AWS Ohio, Hyperdrive query caching disabled and an origin connection limit of five. No infrastructure setting was changed. Pool contention can amplify concurrent workloads; the primary reproducible issue is the application's sequential database work.

No artificial sleep, minimum spinner duration or simulated delay exists in these list endpoints. `SIMULATION_DELAY_MS=2000` belongs to background providers, scans and extraction. Those domain simulations remain independently configured; they are not a reason to delay reading a queue.

### Cause and changes

- `listStaffApplications` previously reconciled tasks and checks for every returned application, serially, while holding application update locks. Even an unchanged queue performed hundreds of database round trips and could contend with individual workspace requests. It now authorizes staff, pages within the bank/synthetic scope, and reads the page's saved task-progress fields in one additional query. It performs no reconciliation, writes or application update locks. Existing mutation and individual-workspace reconciliation remains authoritative. A draft without materialized tasks returns unknown (`null`) progress rather than asserting zero requirements.
- The lender workspace treated focus and visibility changes as blocking `/options` checks, hiding all content behind “Checking staff access…”. It now checks the lightweight session endpoint in the background, coalesces concurrent focus/visibility events, and validates active staff status and the exact session token. Denial or failed verification still hides protected content; revoked/replaced sessions clear the private query cache. Each authenticated session gets a separate workspace/cache, including reauthentication as the same account.
- `/accounts` retains the 30-second collaboration refresh, without an extra focus-triggered read. Its existing data stays visible during refresh, and timer retries stop after a failure. Funding mutation invalidation and explicit retry remain intact.
- Safe API timing logs now distinguish `staff-applications`, `options` and `accounts`, instead of placing all three in `other`. No raw identifier, URL, query, session or document content is added to application logs.

### Controlled query comparison

The old and new list functions were run against the same hosted synthetic bank/page from this machine. Both used an outer transaction that was deliberately rolled back; no benchmark reconciliation or intent was committed. With the same 17 rows and identical task-progress totals, the old implementation used **350 SQL statements / 19,168 ms** and the new implementation **8 statements / 438 ms**. Both counts include the benchmark's `BEGIN` and `ROLLBACK`; the ordinary service transaction additionally sets its isolation level. This demonstrates the eliminated round trips on identical data. It is not a measurement of the fixed public Worker: direct database latency differs from Worker-to-Hyperdrive latency.

Private scripts `.local/lender-latency-audit.mjs` and `.local/lender-query-audit.mjs` keep database credentials and cookies private and print only durations, counts and aggregate progress. The former signs into the synthetic account and invokes ordinary authorized reads; the latter rolls back all work.

### Local acceptance

- `pnpm test`: **429 tests passed** in 40 files.
- Real PostgreSQL staff domain and both HTTP transport suites: **27 tests passed**. New coverage asserts a constant query count across page sizes, identical saved progress, no task mutations/application update locks, and unknown progress for untouched drafts. Existing cases verify scoped counts, stable pagination, filters, staff membership, synthetic-only visibility, revision conflicts and replay behavior.
- Isolated `request-efficiency.spec.ts`: **6 desktop/mobile cases passed**, zero skipped/failed, in `.local/e2e-41ftkc`. Coverage includes pending session/account reads without page hiding or lost input, deduplicated focus events without options reads, actual cross-tab logout removing protected content, and the prior borrower idle-request regression.
- `pnpm typecheck`: all **12 workspaces** and root types passed. `pnpm lint`: **423 files** and browser boundaries passed.
- Cloudflare-mode lender build and native API/lender Worker dry runs passed. The existing frontend chunk-size advisory remains; it does not account for the measured API execution delay.
- No schema migration, dependency, connection-limit or deployment-setting changes. No production code was published during this investigation. Re-run the saved HTTP probe after publication before claiming a hosted improvement.


### Neutral reload state — October 9 follow-up

The user additionally reported the login-page flash during authenticated reloads. The shared identity component already had an explicit loading state, but rendered that state inside the sign-in card and welcome layout. It now returns only the shared neutral “Checking access…” loading state until the session and, for staff, membership verification finish. Neither login UI nor private workspace is rendered while access is unknown. An HttpOnly cookie remains server-verified; no browser-storage authentication hint or bypass is introduced. The same state applies during explicit retry and sign-out transitions.

Acceptance: delayed session and staff-membership responses must never expose the sign-in card or protected content; valid sessions resume their workspace; confirmed anonymous sessions show login; failed checks offer retry without assuming anonymous access. Both borrower and staff portals are covered.

Final follow-up validation: **14/14 desktop/mobile cases** passed across `session-loading.spec.ts` and `request-efficiency.spec.ts`, zero skipped/failed, in `.local/e2e-QXmUZ9`. All 12 workspace/root typechecks, lint (**424 files** plus boundaries), and Cloudflare-mode lender/borrower builds pass. The 429-unit/27-PostgreSQL performance checkpoint above remains applicable to the unchanged request/domain behavior. API, lender and borrower native dry runs pass on the final code. Deployment remains pending.
