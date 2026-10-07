# D04 — Hosted request efficiency and latency

Dependencies: D02, D03, T12, T16. Read [architecture](../02-architecture.md), [access rules](../03-domain-and-access.md), and [development/testing](../05-development-and-testing.md).

Status: In progress — October 7, 2026. The production bottleneck is reproduced; local request-efficiency changes are implemented. Hosted improvement must be measured after deployment before claiming a production speedup.

## User request and bounded change

Investigate several-second startup/task/readiness loads, slower saves, and repeating session/resource requests in the deployed synthetic demo. Reduce unnecessary requests while retaining server-side identity, bank, participation, private-resource and workflow checks. No real external services, financial operations, new infrastructure or schema change is needed.

## Acceptance criteria

- Protected browser reads/writes use one resource request, with server-validated binding to the workspace's session; an identity change or revoked session is denied. Late responses after a local identity change cannot populate a different account's workspace.
- Idle document, check, readiness and review reads use a 30-second collaboration refresh. Current uploaded documents undergoing scan/interpretation and actively executing checks retain three-second updates. Historical/stale runs and checks waiting for human input do not trigger fast polling. An error stops timer retries until explicit retry/focus/mutation invalidation.
- Task saves and the existing conflict, navigation, private-access and revocation regressions remain correct. Existing mutation-driven invalidation remains authoritative for local edits.
- Configure API placement near the existing Neon AWS Ohio database and publish safe response timing/log metadata. Keep Hyperdrive query caching disabled; do not cache authorization on the server.
- Verify the native Worker bundle and record local type/lint/build, unit, PostgreSQL, and desktop/mobile request-count checks.
- After a requested deployment, repeat production serial/concurrent reads and report actual before/after timings. This criterion remains pending.

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
- Production after-change timings remain unverified. No deployment, commit or push is part of this diagnostic change.

### Final local checkpoint

- Full unit suite: **283/283 pass** in 25 files, including 11 new focused request/refresh tests and older-API rollout protection.
- Both final PostgreSQL identity transport suites: **8/8 pass**, including the server response binding marker. The complete PostgreSQL checkpoint above remains **350/350 pass**; the final marker-only addition was rechecked in the affected suite.
- Desktop navigation/account-switch coverage: nine existing cases pass in `.local/e2e-H1vaxn`; final borrower/staff save-conflict and stale-answer cases plus desktop idle-network acceptance pass **4/4** in `.local/e2e-hPXyYc`. Final mobile idle-network acceptance passes **1/1** in `.local/e2e-dcZRfp`. The combined selected coverage is 14 applicable cases with no outstanding failures.
- The idle-network test observes one completed session read, one tasks/documents/readiness read each, no hidden review request, and no further completed resource/session responses through 12 seconds of browser clock advancement. This verifies request reduction without promising a production latency threshold.
- Final types, lint/boundaries, all 12 builds, `git diff --check`, and native API deployment dry run pass. Native bundle evidence is under `apps/api/.local/d04-api-dryrun`; the dry run uploads nothing and verifies placement/bindings. No migrations were introduced.
