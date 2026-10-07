# D02 — Cloudflare deployment and Neon runtime connection

Status: Done — October 6, 2026. Native deployment and hosted connections verified.

Dependencies: D01, T04, T05. Read [architecture](../02-architecture.md) and [decisions](../06-decisions-and-sources.md).

## Outcome

Deploy the current foundation through native Cloudflare Git builds on `main`, with three frontend Workers, a shared API and event-driven jobs connected to Neon through Hyperdrive. The user created the five Workers and requested fixing their failed deploy commands and provisioning the remaining connections.

## Acceptance criteria

- Pin current Wrangler in the workspace lockfile; all five advertised configuration paths exist and deploy dry runs pass.
- Native Cloudflare builds use repository root `/`, app-specific commands and `main`; actual builds and hosted health checks pass.
- Each UI forwards `/api/*` through an API service binding and links to hosted workspaces without leaking backend credentials.
- API and jobs use request-scoped Hyperdrive connections with query caching disabled; schema readiness is verified without running migrations from Workers.
- GitHub Actions configures a separate runtime login without schema/role administration or audit update/delete privileges.
- Queues deliver operation IDs; transactional outbox, idempotence, stale-input and lease recovery semantics remain in place. Cron recovers pending work without a persistent Node polling loop.
- Database credentials remain ignored locally and encrypted in GitHub/Cloudflare; hosted setup never invokes local initialization or full local fixture seeds. Explicit demo bank/product configuration is separate from schema migrations.

## Implementation record

In progress — October 6, 2026. Cloudflare confirms all five Workers and native repository build triggers exist. Their root is `/` and commands match the agreed table. The reported deploy failure is caused by missing Wrangler and configuration files. Wrangler 4.148.0 is the latest published release at setup; `cf` 1.0.0-beta.12 remains suitable for resource management. Hyperdrive and queue provisioning are authorized by the user's latest request.

Implemented: five configs/entrypoints, generated API/jobs binding types, native HTTP adapter, platform rate limiting, same-origin UI service proxies, hosted navigation/origins on the user's new `kualia.workers.dev` subdomain, request-scoped Hyperdrive connections, portable outbox/operation processor, Queue consumer and minute recovery Cron. Fastify runtime code generation was found incompatible in a real workerd probe and replaced by a native hosted transport; local Fastify remains in place.

Provisioned `keycade-db` Hyperdrive (cache disabled, five origin connections) and `keycade-jobs` Queue. GitHub run [37560937054](https://github.com/igoramidzic/keycade/actions/runs/37560937054) configured the separate runtime login successfully. Direct TLS login verified migration-history reads and denied schema administration/audit edits. The one-time setup flag is now disabled.

Pre-deployment checks: workspace types and Biome/browser boundaries passed; 105 existing unit and 43 real PostgreSQL integration checks passed after portable job extraction. Five new Worker transport tests passed. All three Vite builds and frontend deploy dry runs passed; API/jobs bundle dry runs passed. Local workerd returned health 200, readiness 200 (real PostgreSQL plus jobs service binding), and anonymous application 404. Native build and hosted checks remain pending.

Final pre-push verification: 44 real PostgreSQL integration checks passed, including Cron-to-queue adapter retry and duplicate-effect fencing. Hosted URLs rebuilt for `kualia.workers.dev`. Final API and jobs dry runs passed; local health/readiness/OpenAPI returned 200.

Hosted acceptance passed on implementation commit `9eb09517c5f31d0c8bd6c246c4ad9382b0cceb9c`:

- All five native Cloudflare builds finished with `success`: API `063cea25-7528-420e-8714-21dd1cb910c4`, jobs `5b3ba279-e0a0-46c5-b18c-83a3fc0d370c`, bank site `5c2a9afd-354a-4207-be0c-9469ce940270`, borrower `457946cf-98bd-4e73-b477-52d5aecaba5c`, console `2b947097-07da-46b1-aaec-dc786f8530be`.
- All three hosted pages and each same-origin `/api/health` and `/api/ready` returned 200. Readiness confirmed real Neon connectivity and the private jobs service. Direct API diagnostics also returned 200.
- Served JavaScript contained all three `kualia.workers.dev` navigation URLs, with no old subdomain or localhost navigation. Claimed user/role headers still returned anonymous application 404 through each frontend.
- Cloudflare read-back confirmed frontend `API`/`ASSETS`, API `HYPERDRIVE`/`JOBS`/rate-limit, and jobs `HYPERDRIVE`/Queue bindings. Queue consumer is `keycade-jobs` with the configured retry/batch settings; Cron is `* * * * *`.
- GitHub migration [run 37562095102](https://github.com/igoramidzic/keycade/actions/runs/37562095102) passed for this commit. Hosted read-only counts confirmed two migrations and zero banks, users, applications or integration runs. No hosted seeds were applied.
- Final workspace types, Biome/browser boundaries, 110 unit checks and 44 real PostgreSQL integration checks passed. Temporary workerd verification server stopped; original local development services remain available.

Handoff: [Cloudflare settings](../../../infra/cloudflare.md). The current three UIs are foundation shells; passwordless identity and application intake remain T06–T10. R2 remains T13. Native build and GitHub migration triggers are independent, so schema-dependent releases require additive migrations and readiness checks. Separate CI regression validation remains paused by explicit user request.

## Hosted intake recovery — October 7, 2026

The user reported 404 from the deployed borrower `GET /api/v1/public/banks/bank-a/intake`. Reproduced the response while `/api/ready` returned 200. A read-only Neon query confirmed zero banks and zero products; `readPublicIntake` returns the generic not-found response for an absent bank. Local initialization had supplied the missing configuration only to Podman.

Applied [bootstrap-demo-intake.sql](../../../infra/bootstrap-demo-intake.sql) explicitly to the configured Neon database with verified TLS. It creates only synthetic `bank-a` and its fixed business-credit product, transactionally and without overwriting existing rows. Repeated the bootstrap and compared configuration: unchanged. Read-back confirmed one bank, one product, zero users and zero applications.

Live acceptance: the exact reported borrower endpoint returned 200 with the bank and product ($10,000–$7,500,000 USD); unknown-bank intake returned 404; database/jobs readiness remained 200. No Worker redeployment was necessary. Full hosted authentication and application creation remain outside this targeted validation.
