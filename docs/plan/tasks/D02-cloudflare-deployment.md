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
