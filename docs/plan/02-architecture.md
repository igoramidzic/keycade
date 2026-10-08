# Architecture and repository layout

The [v2 plan](v2/README.md) adds planned experience and data contracts to the existing architecture. V2-01–V2-05 are implemented locally with task-specific validation records; V2-06–V2-08 remain planned. Historical task records do not prove v2 behavior. Follow [the experience specification](v2/02-experience-spec.md), [data and simulation contracts](v2/03-data-and-simulation.md), and [delivery/validation plan](v2/04-delivery-and-validation.md) for its bounded changes.

## Deployment target

Cloudflare is the intended hosted platform (user clarification, October 6, 2026); the five Keycade Workers and their native Git build triggers exist. Initial hosting uses default `workers.dev` URLs without a custom domain. The existing account subdomain is `kualia.workers.dev`. Neon is selected for PostgreSQL only and the existing project is linked; Hyperdrive `keycade-db` is provisioned with caching disabled and a separate runtime login. Document storage remains planned for R2. GitHub Actions owns hosted Drizzle migrations, separately from local initialization. This document’s Node/Fastify/pg-boss topology is the local foundation. The hosted compatibility and infrastructure slice is tracked in [D02](tasks/D02-cloudflare-deployment.md), with the rationale in [decisions](06-decisions-and-sources.md#cloudflare-implementation-boundary-october-6-2026). Keep domain services and transactional intent separate from HTTP, queue, timer, and file-storage adapters. Do not assume a persistent Node queue polling loop runs unchanged inside a request-driven Cloudflare Worker. PostgreSQL remains required; choosing Cloudflare does not replace it with D1.

## Chosen starting architecture

Hosted application deployments will use Cloudflare Workers Builds connected directly to `igoramidzic/keycade`, deploying from `main` with per-Worker build/deploy settings. GitHub Actions remains responsible for Neon migrations. The deployment implementation must coordinate schema-dependent releases because these systems trigger independently; see [the recorded choice](06-decisions-and-sources.md#cloudflare-native-git-deployment-october-6-2026).

Use a TypeScript modular backend with three React/Vite frontends, one Fastify HTTP API, one independently runnable Node worker, and one PostgreSQL database. The API and worker share domain modules and database ownership. Split into more backend services only when a concrete requirement justifies it.

| Layer | Choice | Purpose |
| --- | --- | --- |
| Workspace | pnpm workspaces + Turborepo | Shared packages and consistent development/build tasks. |
| Frontends | React + Vite + React Router | Independent mock bank, borrower, and staff applications. |
| Server state/forms | TanStack Query; React Hook Form with shared validation | Caching, invalidation, autosave, and consistent form errors. |
| UI | shadcn/ui + Tailwind CSS | Generated components with default styling. |
| HTTP API | Node.js + Fastify | Explicit routes, runtime validation, authorization, and OpenAPI contract. |
| Contracts | Zod request/response schemas with a supported Fastify integration | Shared browser-safe types; verify package compatibility during T01/T04. |
| Database | PostgreSQL + Drizzle ORM/Kit | Relational records, transactions, versioned migrations, local Studio. |
| Background work | pg-boss + transactional outbox | Durable Postgres-backed jobs without a second queue service. |
| Files | Private local storage behind a storage interface | Easy local setup, replaceable by object storage later. |
| Email | Mailpit local SMTP/inbox behind an email adapter | Test real link journeys without delivering external email. |
| Quality | Biome, TypeScript, Vitest, Playwright | Formatting/linting, types, service tests, browser journeys. |

Pin mutually compatible maintained versions at implementation time, including the Node LTS version and pnpm version. Commit the lockfile. This plan intentionally does not guess future package versions.

## Intended layout

```text
apps/
  bank-site/          mock bank homepage and application entry
  borrower/           required setup wizard, passwordless return, task portal
  bank-console/       staff pipeline and application workspace
  api/                HTTP routes, session handling, webhooks, health
  worker/             durable jobs, schedules, outbox dispatch
packages/
  contracts/          browser-safe schemas and public DTOs
  domain/             server-only use cases and permission policies
  db/                 server-only Drizzle schema, migrations, seeds
  integrations/       server-only provider interfaces and fake adapters
  ui/                 CLI-generated shadcn components and shared styles
  config/             shared TypeScript configuration
  testing/            synthetic fixtures and test utilities
scripts/              initialize, prerequisite checks, local lifecycle
infra/                Podman definitions and service configuration
docs/plan/            this plan and implementation tasks
```

Create each package when needed. T01 creates app shells and the initial shared configuration/UI/contracts boundaries; later tasks add database, domain, integration, and testing content. No frontend imports from `db`, `domain`, or `integrations`. No app imports another app's internals.

Dependency direction: apps → domain/integrations/contracts/UI as appropriate; domain → contracts/db/provider interfaces; integrations → contracts/provider interfaces, never back into application routes. Keep provider interface ownership in one shared server module to avoid a domain/integrations import cycle.

## Request and job flow

1. Browser → API → authenticated principal and bank/application authorization.
2. API invokes a domain use case with validated data, actor, bank scope, and an idempotency key where needed.
3. The use case commits business state, audit records, and outbox events in one PostgreSQL transaction.
4. The worker dispatches outbox records to pg-boss using a stable event identity. A crash may deliver twice; handlers deduplicate business effects.
5. Jobs call a provider interface and persist run status/result/input revision. Polling screens fetch a safe, authorized summary.

The initial public email-start endpoint is a restricted exception: it resolves a configured public bank slug, creates a pending draft/contact, sends a link, and returns a generic acknowledgment. It grants no authenticated access and cannot select arbitrary private bank IDs.

## API organization

Use `/api/v1` and resource modules for authentication, applications, businesses, participants, tasks, documents, checks, signatures, decisions, funding, activity, and operations. Generate OpenAPI documentation from validated route contracts. Do not create a public integration credential system yet.

Use explicit commands for state transitions instead of a generic endpoint that lets clients set arbitrary statuses. Service methods accept an actor context and enforce permissions even if invoked outside an HTTP route. Internal jobs get a limited system actor and explicit tenant context.

All creation entry points call `createApplication`: borrower lead, bank staff, and a future bank API/SSO adapter. Record source and creator, enforce bank/product validity, and apply the same idempotency rules. A future external bank API reuses the same domain use case.

Keep the initial setup wizard and application portal as distinct routes within the borrower app. T07 owns persisted per-application setup state, revision-aware answer/step saves, and an explicit idempotent completion command; T08 owns the one-question screens; T09 owns the portal and return routing. Resolve the next destination from authorized server state after authentication or application selection. Browser storage and route parameters cannot mark setup complete. Shared domain guards enforce the setup prerequisite for applicant portal operations in both HTTP transports, while retaining staff draft access and scoped collaborator permissions.

### V2 additions — planned, not implemented

- Keep separate borrower and lender presentation shells. The borrower dashboard has tasks and a progress/upload sidebar with contextual actions, without top-level application tabs; the lender keeps tabs and adds overview/evidence projections. Share authorized task, document and upload components without assuming both personas have the same navigation or fields.
- Extend browser-safe setup schemas and versioned persistence for legal name, structured address, optional website, and structured purpose selections. Reuse optional NAICS search and the fixed product. A narrow business-identifier setup command delegates to existing server-only encryption and masking; it does not open general enrichment or portal operations before setup.
- Add scoped overview projections for financial facts, evidence-group counts and geographic results. Counts and detail reads must use the same permission predicates, including private task/document restrictions. Reuse the existing request-efficiency policy; opening a group or modal must not trigger repeated full-workspace polling.
- Add protected document-preview/info/history reads and an explicit staff command for adopting selected financial facts. Persist source document/version/run, fiscal period, currency, actor, revision and audit in the same transaction as adoption. Local Fastify and native Workers transports invoke the same domain contracts.
- Add the text-trigger importer to the authenticated demo tooling. Its allowlisted filename registry selects versioned synthetic fixtures; generated PDF bytes use the existing private storage, scan and interpretation pipeline. Normal uploads keep content validation and content-bound scenarios. Mock geographic evaluation uses saved address revisions and local fixture map data, with no network geocoder or real eligibility provider.
- Use additive Drizzle migrations and upgrade tests for new records and setup versions. Completed legacy setups stay complete; preserve legacy free-text purposes and immutable submissions. Neither financial adoption nor business-profile edits propagate silently across applications.

List endpoints use stable pagination and an allowlist of filters/sorts. Response DTOs omit secrets and internal evidence. Return structured errors with a request ID; conceal inaccessible record existence. Use revision checks for autosave, task reviews, decisions, and other conflicting edits.

## Local services and routing

Proposed default ports, all configurable:

| Process | Port |
| --- | --- |
| Mock bank site | 3000 |
| Borrower portal | 3001 |
| Bank console | 3002 |
| API | 4000 |
| PostgreSQL | 54329 (host) → 5432 (container) |
| Mailpit inbox / SMTP | 8025 / 1025 |
| Drizzle Studio | 4983, launched separately |

The worker has no public HTTP port. Use heartbeat metadata for its readiness. Browser apps proxy `/api` to the API during development, keeping cookie behavior straightforward. All app servers and infrastructure bind to loopback locally. Validate allowed origins, cookie settings, CSRF protection, and return URLs explicitly; never treat CORS as authorization.

Postgres and Mailpit run through Podman. On macOS the initialize script verifies the Podman machine and starts/initializes the project-appropriate local environment as needed. Detect the compose provider if using `podman compose`; do not silently assume Docker tooling exists.

## Storage and schema ownership

Drizzle owns Keycade application tables and committed SQL migrations. pg-boss owns its internal schema according to its documented lifecycle; do not generate conflicting Drizzle migrations for it. Test both bootstrapping together against the selected Postgres version.

Use UUID identifiers, UTC timestamps, foreign keys and uniqueness constraints. Monetary values use Postgres `numeric(20,2)` and decimal-string DTOs in the USD prototype; never round-trip through JavaScript floating point. Store binary uploads outside the repo's public folders and outside Postgres, with opaque storage keys and metadata in the database.

Use an environment-specific private data directory with restrictive permissions for the local storage adapter. Seed/test fixtures are synthetic. Local storage is not the production backup or retention design.

## Deliberate limits

No Redis, Kubernetes, event-streaming platform, microservice mesh, or separate workflow engine is needed initially. No real provider secrets are required. Production identity, file storage, deployment, backup/restore, bank retention policies, and live integrations are later decisions, with concrete placeholders in [decisions](06-decisions-and-sources.md).

## Hosted runtime adapters (D02)

The three frontend Workers serve static assets and proxy `/api/*` through the `API` service binding. They expose only public workspace URLs. The hosted API uses the native Request/Response transport with the existing Zod contracts, domain services and authorization rules; local Node continues to use Fastify. Fastify's router generates functions at runtime, which Workers prohibit. T06 must connect the trusted session resolver and CSRF policy to both transports; neither accepts identity from client headers.

API and jobs open request/event-scoped PostgreSQL pools (maximum one client) through `HYPERDRIVE`, then close them. Cloudflare manages database pooling. Readiness checks migration timestamps and real required columns without applying SQL changes. GitHub alone checks full migration hashes and applies committed SQL.

The hosted jobs Worker consumes operation IDs from `keycade-jobs`. A minute Cron recovers expired leases and dispatches pending outbox rows. Queue delivery may duplicate; operation IDs, claim tokens, transaction locks, stale-input checks and effect deduplication fence effects. Future pending application writes remain transactional. The jobs Worker has no public URL; the API reaches its internal readiness endpoint by service binding. Local jobs retain the pg-boss poller and heartbeat.
