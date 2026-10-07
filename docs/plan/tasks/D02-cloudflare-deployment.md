# D02 — Cloudflare deployment and Neon runtime connection

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
- Database credentials remain ignored locally and encrypted in GitHub/Cloudflare; hosted setup never invokes local initialization or seeds.

## Implementation record

In progress — October 6, 2026. Cloudflare confirms all five Workers and native repository build triggers exist. Their root is `/` and commands match the agreed table. The reported deploy failure is caused by missing Wrangler and configuration files. Wrangler 4.148.0 is the latest published release at setup; `cf` 1.0.0-beta.12 remains suitable for resource management. Hyperdrive and queue provisioning are authorized by the user's latest request.

Implemented: five configs/entrypoints, generated API/jobs binding types, native HTTP adapter, platform rate limiting, same-origin UI service proxies, hosted navigation/origins on the user's new `kualia.workers.dev` subdomain, request-scoped Hyperdrive connections, portable outbox/operation processor, Queue consumer and minute recovery Cron. Fastify runtime code generation was found incompatible in a real workerd probe and replaced by a native hosted transport; local Fastify remains in place.

Provisioned `keycade-db` Hyperdrive (cache disabled, five origin connections) and `keycade-jobs` Queue. GitHub run [37560937054](https://github.com/igoramidzic/keycade/actions/runs/37560937054) configured the separate runtime login successfully. Direct TLS login verified migration-history reads and denied schema administration/audit edits. The one-time setup flag is now disabled.

Pre-deployment checks: workspace types and Biome/browser boundaries passed; 105 existing unit and 43 real PostgreSQL integration checks passed after portable job extraction. Five new Worker transport tests passed. All three Vite builds and frontend deploy dry runs passed; API/jobs bundle dry runs passed. Local workerd returned health 200, readiness 200 (real PostgreSQL plus jobs service binding), and anonymous application 404. Native build and hosted checks remain pending.

Final pre-push verification: 44 real PostgreSQL integration checks passed, including Cron-to-queue adapter retry and duplicate-effect fencing. Hosted URLs rebuilt for `kualia.workers.dev`. Final API and jobs dry runs passed; local health/readiness/OpenAPI returned 200.
