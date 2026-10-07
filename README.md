# Keycade

Keycade is a bank-operated business lending prototype. The first testable milestone, **T01–T05: Local foundation**, is implemented: three React shells, repeatable local infrastructure, a seeded PostgreSQL schema, API authorization foundations, and a durable simulated job runner.

The screens currently demonstrate navigation and live service readiness. Login, application intake, and the borrower/staff application experience are the next milestone (T06–T10). All records and provider results are synthetic. No financial or identity determination is real.

## Start locally

Prerequisites: Node **24.21.0 LTS** (`nvm install && nvm use` if using nvm), pnpm **10.34.6**, and [Podman](https://podman.io/docs/installation). A project-local Node 24 runtime is also installed with dependencies, so workspace scripts use the pinned runtime even if the shell uses a newer Node. The shell may print an engine warning until switched to `.nvmrc`.

On macOS, create a Podman machine once if none exists (`podman machine init`). Initialization starts the configured machine. No Compose provider is needed. Unset `CONTAINER_HOST` and `CONTAINER_CONNECTION`; these local commands refuse remote Podman overrides.

```sh
pnpm install
pnpm initialize
pnpm dev
```

Initialization creates a private ignored `.env`, starts project-owned PostgreSQL 18.6/Mailpit on loopback ports, authenticates to the configured database, applies committed migrations, initializes pg-boss, and inserts missing synthetic fixtures. Running it again preserves existing env values and records. It never resets a volume or stops unrelated services. Change names/ports in `.env` before first setup if defaults are occupied; a pre-existing container must continue to match its configured image, identity, storage and port bindings.

`pnpm dev` verifies actual SQL connectivity, migration history, and queue schema before starting apps. The API becomes ready only after a healthy worker heartbeat. Environment overrides are passed explicitly through Turbo; browser bundles receive only the three public application URLs.

| Surface | Default URL | What to test now |
| --- | --- | --- |
| Mock bank shell | http://127.0.0.1:3000 | Shared UI, links, API/service status |
| Borrower shell | http://127.0.0.1:3001 | Responsive layout and health retry |
| Bank console shell | http://127.0.0.1:3002 | Cross-app navigation and health retry |
| API liveness / readiness | http://127.0.0.1:4000/api/health · http://127.0.0.1:4000/api/ready | Process health vs database/worker readiness |
| OpenAPI | http://127.0.0.1:4000/api/openapi.json | Validated initial API contract |
| Mailpit | http://127.0.0.1:8025 | Local inbox is available; email delivery arrives in T06 |
| Drizzle Studio | `pnpm db:studio`, then https://local.drizzle.studio | Core data and durable job history; listener binds only to 127.0.0.1:4983 |

No public impersonation shortcut exists. Application API routes deliberately deny anonymous access until T06 implements passwordless sessions. Service/HTTP tests supply actors internally and enforce current bank memberships and application grants.

## Try background work

With `pnpm dev` running, use a second terminal:

```sh
pnpm jobs:demo success
pnpm jobs:demo transient_error
pnpm jobs:demo missing_input
pnpm jobs:demo timeout
pnpm jobs:demo terminal_error
```

This protected local command targets a known synthetic application and prints persisted transitions. Success creates one harmless logical effect/audit event. Transient failure retries; missing input stays waiting; exhausted deadlines/errors remain visible. Inspect `integration_runs`, `outbox_events`, `effect_deduplications`, and `audit_events` in Studio. These commands make no real external calls.

Change `SIMULATION_DELAY_MS`, `PROVIDER_DEADLINE_MS`, or `JOB_MAX_ATTEMPTS` in `.env` and restart dev to vary the demo. Ctrl-C stops the app processes; PostgreSQL and Mailpit remain running. `pnpm infra:stop` stops only the project containers and keeps database storage. `pnpm infra:start` restarts them.

## Commands and verification

| Command | Behavior |
| --- | --- |
| `pnpm check` | Biome, browser/server boundary check, strict types, unit tests |
| `pnpm build` | Production Vite output and server/shared-package compile checks; local servers execute TS with tsx |
| `pnpm test:integration` | Fresh disposable real PostgreSQL databases; migrations, isolation, transactions, queue recovery, and an actual SIGKILL/restart |
| `pnpm test:e2e` | Playwright desktop/mobile against initialized local services; starts dev when needed |
| `pnpm format` | Apply Biome formatting and safe fixes |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes for review |
| `pnpm db:migrate` / `pnpm db:seed` | Apply committed schema / insert missing synthetic fixtures on the recognized local target |
| `pnpm db:migrate:neon` | GitHub Actions only: apply pending committed migrations to the explicitly configured Neon target |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | Persistent project database lifecycle and authenticated status |
| `pnpm infra:start` / `pnpm infra:stop` | Database and Mailpit lifecycle |

If Playwright Chromium is missing, run `pnpm exec playwright install chromium` once. Integration tests require initialized Podman infrastructure and delete only the fresh test databases they create, never the developer database. The optional maintainer probe `pnpm exec tsx scripts/verify-local.ts` checks repeated initialization and database stop/start persistence; stop dev and Studio first because the probe intentionally stops the project database briefly.

Invalid credentials or an unavailable database stop development before apps launch. A behind/unusable schema points to `pnpm db:migrate`. Port collisions and unfamiliar database targets fail without stopping or changing their owners. Preserve your `.env` and volume rather than resetting either to fix a configuration mismatch.

## Synthetic fixtures

`packages/db/src/seed.ts` exports stable `seedIds`. Bank A contains two businesses and explicit borrower participation in two applications; another application for the same business remains unshared. Bank B is isolated. Fixtures include $10,000, $5,000,000, $7,500,000, and an incomplete draft, plus a restricted adviser and revoked owner. Emails end in `example.test`; they are fixture identities, not current login credentials. No EINs, SSNs, documents, or funded accounts are seeded at this milestone.

## Cloudflare direction

Cloudflare is the intended deployment platform, initially using the existing `kualia-analytics.workers.dev` subdomain without a custom domain. The `cf` CLI account login is verified; no Keycade Workers are provisioned. Neon PostgreSQL is linked and its connection is verified. Neon supplies the database only; document storage remains planned for Cloudflare R2. Local Podman settings remain in `.env`; hosted credentials are in the separate ignored `.env.neon`.

GitHub Actions owns hosted schema changes through [the Neon migration workflow](.github/workflows/neon-database.yml). For faster demo deployment, automatic tests/build validation and the PR trigger are commented out; eligible `main` pushes go directly to pending committed Drizzle migrations. Tests remain available locally. The approved encrypted credential is configured in the `neon-production` environment, restricted to the `main` branch. See [setup and operation](infra/neon.md). `apps/worker` is currently a **local Node job runner**. Cloudflare hosting still requires the HTTP adapter, Hyperdrive, durable job delivery, secrets and origins; the database workflow does not deploy the application.

See the [implementation plan](docs/plan/README.md), [validation record](docs/plan/local-foundation-validation.md), and [agent instructions](AGENTS.md) before continuing. The next coherent milestone is **Start and resume (T06–T10)**. Servicing remains deferred; the first release ends with simulated approval/funding.
