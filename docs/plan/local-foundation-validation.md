# Local foundation validation — October 6, 2026

Scope: T01–T05. This is the first demonstrable milestone from the original plan. T06–T22 remain unstarted. Cloudflare is the future deployment target; no Cloudflare resources were provisioned.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm check` | Biome, browser/server boundary scan and strict workspace/root types passed. Final unit rerun: 52 tests across 5 suites passed, including 16 initialization safety cases. |
| `pnpm build` | All 12 workspace build tasks passed; three Vite production outputs built with shared default shadcn styles. Server/shared build tasks validate TypeScript; local server start uses tsx. |
| `pnpm test:integration` | 36 tests across 4 suites passed on real PostgreSQL in fresh disposable databases. |
| `pnpm test:e2e` | 10 Playwright desktop/mobile tests passed against the actual initialized API and worker. |
| `pnpm list -r react react-dom --depth 0` | All three apps and shared UI resolve React/React DOM 19.3.0. |
| Migration generation | No schema drift after checked-in `0000` core and `0001` durable-jobs migrations. |
| Secret/boundary checks | Root `.env` and `.local/uploads` are Git-ignored; only `pnpm-lock.yaml` exists outside dependencies. None of the actual database URL, database password, session secret or encryption key occurs in any production browser JS/CSS bundle. |

PostgreSQL suites cover exact decimal reads/writes, invalid input/foreign keys/uniqueness, independent application participation, seed idempotency, migration readiness, cross-bank and same-bank denials, revoked participants, safe DTOs, service authorization, transaction/audit rollback, optimistic revisions, and concurrent updates.

Job tests cover a rollback before enqueue, dispatcher crash between send and acknowledgement, duplicate concurrent delivery, fetch-before-claim recovery, interrupted work, stale-input cancellation, withdrawal, missing input, retries and exhausted attempts, timeouts/terminal errors, fenced expired claims, and worker heartbeat absence. One test launches a separate Node process, kills it with SIGKILL while an operation is running, then confirms a replacement completes attempt two with exactly one effect. Test clocks control provider timing; queue recovery uses bounded real PostgreSQL polling.

## Local acceptance

- `pnpm install` installed the pinned graph and Node 24.21.0 runtime. `npx shadcn@latest` initialized default `base-nova` styling and generated button/card/badge into the shared UI through the supported monorepo route (provenance in `packages/ui/README.md`). No hand-authored substitute components.
- `pnpm initialize` started isolated PostgreSQL 17.7 and Mailpit containers with loopback bindings, authenticated with `SELECT 1`, applied migrations, initialized pg-boss and seeded synthetic records.
- `pnpm exec tsx scripts/verify-local.ts` ran initialization again, verified existing env content byte-for-byte and preserved its own temporary synthetic bank record, stopped PostgreSQL, verified query/dev refusal, restarted it, verified persistence, then deleted only its own probe row. No volume reset or developer-data deletion occurred.
- Bad credentials caused `pnpm dev` to exit nonzero before Turbo/app launch. A stopped database did the same. Unit probes cover missing/hung prerequisites, unrelated live port occupants, and unrecognized/remote DB targets without touching those resources.
- Full `pnpm dev` launched bank site, borrower, bank console, API and worker. All three frontend proxies returned real ready responses. Ctrl-C released all app ports while keeping infrastructure data.
- A separate `API_PORT=4100 pnpm dev` run returned ready on port 4100 and through each frontend proxy, proving environment overrides reach children under Turbo's strict environment mode.
- Browser inspection covered all three shell pages, shared default styling, working navigation and 390-pixel mobile layout. Playwright also verifies network/readiness failures, refresh recovery, and rejection of an HTML fallback as a false health response.
- `pnpm db:studio` bound to 127.0.0.1:4983 and opened successfully. The applications table visibly showed five fixtures, including `10000.00`, `5000000.00`, `7500000.00` USD and nullable incomplete draft values.
- `pnpm jobs:demo success` showed `queued → running → succeeded`, one attempt and one effect. `transient_error` showed `retry_scheduled`, then success on attempt two and one effect. `missing_input` showed `waiting_for_input` and zero effects. Run history remains in the local database for inspection, with simulated provenance.

## Boundaries and next stopping point

The three frontends are usable foundation shells with live status. They do not yet offer login, intake, account creation, lending decisions, documents, signatures or funding. Protected application APIs deny anonymous requests; there is no public actor-header shortcut. Mailpit is available but sending continuation links starts in T06. Only a harmless synthetic job is implemented.

The next coherent milestone is **T06–T10: Start and resume**. The Cloudflare hosting slice is separate: validate runtime/bindings, PostgreSQL hosting/connectivity, durable background adapters, R2 storage, secrets and origins before provisioning/deployment. The local Node/pg-boss runner is not a provisioned Cloudflare Worker.
