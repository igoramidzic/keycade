# Keycade

Keycade is a bank-operated business lending prototype. **T01–T12 are implemented locally**: three React apps, repeatable infrastructure, a seeded PostgreSQL schema, backend authorization, durable simulated jobs, passwordless access, a mock bank page, a resumable one-question application setup wizard, a business-grouped borrower workspace, and a bank staff queue with assignments and internal notes, plus owner records, scoped collaborator invitations, versioned task checklists, and evidence review.

Start at the mock bank, choose **Apply for business financing**, and enter a fictional email. The default local demo opens setup immediately. Answer one question per screen, use **Continue later**, then sign in with the same email to resume the same application. **Finish setup** confirms the answers and opens that application’s portal with Overview, Tasks, Documents, People, and Activity sections. Bank staff can search and filter applications, create and prefill drafts, assign officers, and maintain private internal notes. Applicants and staff can record owners separately from portal access, invite collaborators, and revoke their access. In Tasks, assignees save and submit fictional answers; staff can request changes, complete reviewed tasks, or waive them with a reason.

The optional email-link path supports Mailpit verification, expired links, and fresh-link resume. Saved answers and progress live on the server; browser storage is not required. All records and provider results are synthetic. See [T12’s task walkthrough](docs/plan/tasks/T12-tasks-and-requirements.md#try-it-locally), [T11’s invitation walkthrough](docs/plan/tasks/T11-participants.md#try-it-locally), [T10’s staff walkthrough](docs/plan/tasks/T10-bank-workspace.md#try-it-locally), [T09’s implementation and test steps](docs/plan/tasks/T09-borrower-workspace.md#try-it-locally) and the [identity test guide](docs/plan/identity-validation.md).

## Start locally

Prerequisites: Node **24.21.0 LTS** (`nvm install && nvm use` if using nvm), pnpm **10.34.6**, and [Podman](https://podman.io/docs/installation). A project-local Node 24 runtime is also installed with dependencies, so workspace scripts use the pinned runtime even if the shell uses a newer Node. The shell may print an engine warning until switched to `.nvmrc`.

On macOS, create a Podman machine once if none exists (`podman machine init`). Initialization starts the configured machine. No Compose provider is needed. Unset `CONTAINER_HOST` and `CONTAINER_CONNECTION`; these local commands refuse remote Podman overrides.

```sh
pnpm install
pnpm initialize
pnpm dev
```

Initialization creates a private ignored `.env`, starts project-owned PostgreSQL 18.6/Mailpit on loopback ports, authenticates to the configured database, applies committed migrations, initializes pg-boss, and inserts missing synthetic fixtures. Running it again preserves existing env values and records. It never resets a volume or stops unrelated services. Change names/ports in `.env` before first setup if defaults are occupied; a pre-existing container must continue to match its configured image, identity, storage and port bindings.

`pnpm dev` verifies actual SQL connectivity, migration history, and queue schema before starting apps. The API becomes ready only after a healthy worker heartbeat. Environment overrides are passed explicitly through Turbo; browser bundles receive only public application URLs, the local inbox URL, and the hosted-mode flag.

| Surface | Default URL | What to test now |
| --- | --- | --- |
| Mock bank site | http://127.0.0.1:3000 | Apply for financing or continue an application |
| Borrower portal | http://127.0.0.1:3001 | Sign in as `borrower@example.test` to browse two businesses, completed setups, a resumable draft, and a closed application |
| Bank console | http://127.0.0.1:3002 | Sign in as `officer-a@example.test` to search drafts, create an application, assign an officer, and add internal notes |
| API liveness / readiness | http://127.0.0.1:4000/api/health · http://127.0.0.1:4000/api/ready | Process health vs database/worker readiness |
| OpenAPI | http://127.0.0.1:4000/api/openapi.json | Validated initial API contract |
| Mailpit | http://127.0.0.1:8025 | Open a delivered sign-in link, then deliberately confirm in the portal |
| Drizzle Studio | `pnpm db:studio`, then https://local.drizzle.studio | Core data and durable job history; listener binds only to 127.0.0.1:4983 |

Local development explicitly enables **Demo access**: enter an email without mailbox verification, restricted to synthetic users and banks. The optional email-link path verifies mailbox access. Production/hosted mode disables demo sign-in. Application API routes still require a server-side session and current bank membership or application participation. Sign-in alone never creates an application or grants application access. Borrower and staff cookies are isolated by portal origin, including localhost ports.

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
| `pnpm test:e2e` | Isolated desktop/mobile browser suite with disposable PostgreSQL and owned app processes |
| `pnpm format` | Apply Biome formatting and safe fixes |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes for review |
| `pnpm db:migrate` / `pnpm db:seed` | Apply committed schema / insert missing synthetic fixtures on the recognized local target |
| `pnpm db:migrate:neon` | GitHub Actions only: apply pending committed migrations to the explicitly configured Neon target |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | Persistent project database lifecycle and authenticated status |
| `pnpm infra:start` / `pnpm infra:stop` | Database and Mailpit lifecycle |

If Playwright Chromium is missing, run `pnpm exec playwright install chromium` once. `pnpm test:e2e` requires initialized PostgreSQL/Mailpit, creates a disposable database, and starts its own apps on free loopback ports. It runs one test per shard so normal runtime rate limits remain enabled, then stops only its own processes and removes its database. Logs/reports stay in a private ignored `.local/e2e-*` directory. Filter with `pnpm test:e2e -- --project=desktop --grep "bank apply"`; use `pnpm exec playwright test` for advanced interactive runs against your existing development stack. Integration tests require initialized Podman infrastructure and delete only the fresh test databases they create, never the developer database. The optional maintainer probe `pnpm exec tsx scripts/verify-local.ts` checks repeated initialization and database stop/start persistence; stop dev and Studio first because the probe intentionally stops the project database briefly.

Invalid credentials or an unavailable database stop development before apps launch. A behind/unusable schema points to `pnpm db:migrate`. Port collisions and unfamiliar database targets fail without stopping or changing their owners. Preserve your `.env` and volume rather than resetting either to fix a configuration mismatch.

## Synthetic fixtures

`packages/db/src/seed.ts` exports stable `seedIds`. Bank A contains two businesses and explicit borrower participation in four applications: two completed setups, a Cedar draft saved at requested amount, and a withdrawn Cedar draft. Another application for the same business remains unshared. Bank B is isolated. Fixtures include $10,000, $5,000,000, $7,500,000, and an incomplete draft, plus a restricted adviser, revoked owner, and owner relationship with no user account. Emails end in `example.test`; use these synthetic addresses in the local email-link flow. No EINs, SSNs, documents, or funded accounts are seeded at this milestone.

## Cloudflare deployment

The five Workers use native Cloudflare GitHub builds from `main`, with the repository root `/`. [Deployment settings and connections](infra/cloudflare.md) lists their commands, URLs and bindings. Wrangler 4.148.0 is pinned in the workspace; the three UIs serve Vite assets and forward `/api/*` through an API service binding.

API and jobs connect to Neon PostgreSQL through `keycade-db` Hyperdrive with query caching disabled and a dedicated runtime login. Native HTTP, Queues and Cron adapt the existing contracts, domain services and durable outbox to Workers. Fastify and pg-boss remain the local Node transports. Hosted migrations and the one-time runtime-login setup belong to [GitHub Actions](.github/workflows/neon-database.yml); Workers never initialize, migrate or seed the hosted database. See [Neon operations](infra/neon.md).

For faster demo deployment, automatic test/build validation and the PR trigger remain commented out in the Neon workflow. Tests remain available locally. Application builds and migrations trigger independently; readiness fails until required migrations are present. Use additive schema changes and wait for the GitHub migration run before testing a schema-dependent release.

Document storage remains planned for Cloudflare R2 in T13. T06 sign-in is testable locally. Hosted email delivery is explicitly unavailable until a simulated hosted delivery destination is configured; no public inbox, real email provider, or hosted seeds were added. This change has not been deployed. T07–T12 setup, intake, borrower/staff workspaces, participant management, and task review are implemented locally. Staff creation queues a continuation email to Mailpit; hosted staff creation remains unavailable until simulated email delivery is configured. Invitation acceptance requires a verified email-link session and a separate acceptance action; demo sign-in cannot accept. Hosted invitation create/resend remains unavailable until simulated email delivery is configured. Task answers and review are available locally; file/signature evidence, activity, and funded accounts remain with their later tasks. T12 migrations are applied locally; this change has not been deployed.
