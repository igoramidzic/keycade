# Decisions, assumptions, and reference sources

Baseline recorded October 6, 2026. Update this document when a future instruction changes an architectural or product assumption.

## Decisions already made

| Decision | Status / rationale |
| --- | --- |
| Project name: Keycade | Explicit user requirement. |
| Plan first, then implement a testable milestone | Initial planning request; on October 6, 2026 the user authorized the first coherent stopping point (T01–T05 local foundation). |
| First release through approval/funding; servicing later | Explicit user answer during planning. |
| Turborepo, pnpm, React, Node, Postgres, Drizzle/Studio, Biome, shadcn CLI/default styles, Tailwind, Podman | User requirements; pnpm is reflected in the requested root development command. |
| Three frontends plus one API and worker | Planning choice matching separate bank, borrower, and staff experiences. Worker shares backend domain/database ownership. |
| Fastify, Vite, pg-boss, local private storage, Mailpit | Local development choices. Node HTTP and long-running pg-boss entry points are runtime adapters, not the hosted Cloudflare topology. |
| Cloudflare deployment target; no Keycade Workers provisioned yet | Explicit user clarification on October 6, 2026. The user has a Cloudflare account and wants default `workers.dev` URLs initially, with no custom domain. Keep domain/outbox semantics reusable and verify Cloudflare runtime adapters before deployment. |
| Neon for PostgreSQL only; R2 for documents | User selected this after creating the existing Neon project. The project is linked and read-only connectivity is verified. |
| GitHub Actions applies hosted Drizzle migrations | Explicit user request. Keep hosted credentials and execution separate from local Podman initialization. See D01. |
| Cloudflare's native Git integration builds and deploys app Workers on `main` | User's preferred push-to-deploy workflow. Connect the same repository to each app Worker; GitHub Actions remains responsible for Neon migrations. |
| Passwordless, verified email before data access | User wants no password; verification-first is the initial implementation choice. |
| Simulate all third-party services | Explicit user permission; preserve delays, failures, retries, and provenance. |
| USD and US business terminology | Working assumption from EIN, SSN, NAICS, and dollar examples. No legal or regulatory rules are inferred. |
| “NEX” means NAICS | Working interpretation; industry lookup remains optional during initial intake. |
| One demo bank, tenant-aware schema | User asked to start as internal to a bank while describing a product banks will use. |
| Funding is simulated and recorded | No payment rail or core banking provider requested. Funding record is separate from approval. |
| Human lending decisions | Product default; fake risk/AI outputs support review and do not decide credit. |

## Choices to settle when they become relevant

These do not block starting T01. Use documented demo defaults until a task genuinely depends on a business answer.

| Question | Demo default | Needed before |
| --- | --- | --- |
| Exact credit products, amount limits, eligibility and required evidence? | Versioned fictional working-capital/term-loan and commercial-facility templates; no implied regulatory thresholds. | Real product configuration. |
| Which beneficial-owner details/authorization language are required? | Synthetic configurable tasks; no claim of legally sufficient thresholds or consent. | Collecting real applicant data. |
| Should borrowers fill fields before verifying email? | Verify first to avoid provisional unauthenticated editing permissions. | Changing intake UX. |
| Who may approve/fund and what amount requires additional authorization? | Bank officer/admin in the demo, fully audited. | A real bank pilot. |
| What disclosures and decline notices are required? | Clearly fictional demo copy and a recorded decision reason. | A real bank pilot. |
| Which identity, tax, OCR, signature, email, and core banking providers? | Typed fake adapters and Mailpit. | Live provider work. |
| Bank SSO protocol and external create API authentication? | Domain service ready for adapters; no external partner endpoint. | SSO/partner API milestone. |
| Cloudflare topology, PostgreSQL host, private storage, keys, backups and monitoring? | Cloudflare is the deployment target; Workers/resources have not been provisioned. Local Podman and synthetic data remain the initial test environment. Evaluate Workers static assets/API adapter, managed PostgreSQL with Hyperdrive, Queues/Workflows, and R2 in a dedicated deployment slice. | Before any Cloudflare deployment. |
| How should signed/approved terms be amended? | Lock terms after review; no approved-term amendment workflow. | Supporting amendments/refinancing. |
| Detailed servicing behavior? | Separate later plan for accounting, schedules, repayment/draws, reconciliation, collections, and reporting. | Servicing implementation. |

## Reference-product caveat

The supplied `cascading.com` address could not be retrieved during planning. Search located [Casca at cascading.ai](https://www.cascading.ai/), whose public site describes business-loan applications, document collection/analysis, borrower tracking, and bank review automation. It appears relevant but has **not** been confirmed as the intended reference.

The user's requirements define Keycade's scope. Casca's public marketing pages are directional context, not a verified feature inventory or a reason to copy designs, text, underwriting claims, or proprietary workflows. No additional features were silently added to promise parity.

## Primary sources consulted

Sources were checked during planning; exact package compatibility should be rechecked when implementing. Citations support tool capabilities and terminology, while Keycade's choices and acceptance criteria are our design decisions.

| Source | What it supports |
| --- | --- |
| [Casca](https://www.cascading.ai/) and [commercial lending](https://www.cascading.ai/solutions/small-commercial-lending) | Possible reference product's publicly described origination, portal, and document workflows. |
| [US Census NAICS](https://www.census.gov/naics/) | Meaning of NAICS and versioned industry classification reference data. |
| [Turborepo development tasks](https://turborepo.dev/docs/crafting-your-repository/developing-applications) | Persistent dev tasks and disabled dev caching. |
| [shadcn monorepos](https://ui.shadcn.com/docs/monorepo) | CLI-based components and shared UI in a monorepo. |
| [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview) and [Studio](https://orm.drizzle.team/docs/drizzle-kit-studio) | Migration tooling and local database exploration. |
| [Podman machine](https://docs.podman.io/en/latest/markdown/podman-machine.1.html) and [compose](https://docs.podman.io/en/latest/markdown/podman-compose.1.html) | Local machine management and compose-provider prerequisite. |
| [pg-boss documentation](https://github.com/timgit/pg-boss/blob/master/docs/index.md) | PostgreSQL-backed durable jobs and supported transactional integrations. |
| [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | Runtime request validation and response serialization boundaries. |
| [Biome setup](https://biomejs.dev/guides/getting-started/) | Formatter/linter configuration and pinned tooling. |

This document does not prescribe legal, credit, tax, or regulatory policy. Any such policies must come from the bank and be represented as explicit, versioned requirements when real operation is planned.

## Cloudflare implementation boundary (October 6, 2026)

The user identified Cloudflare as the future deployment platform and said no Workers exist yet. This is a platform constraint, not authorization to provision an account, create resources, or deploy the local prototype. T01–T05 continue as a local, testable foundation. `apps/worker` means the local Node background process; it is not a provisioned Cloudflare Worker.

Preserve PostgreSQL/Drizzle and transactional outbox/idempotency guarantees. Before deployment, validate an HTTP runtime adapter and replace or explicitly host the long-running pg-boss dispatcher through a supported topology. Proposed candidates are Workers static assets for Vite output, Workers for HTTP, Hyperdrive to a separately selected PostgreSQL host, Queues/Workflows for background execution, and R2 for private documents. These are deployment candidates, not provisioned infrastructure or verified compatibility claims. Avoid coupling domain rules to Node process lifetimes, local files, or a particular queue transport.

A deployment slice must prove runtime compatibility, migrations and bindings, authenticated database access, outbox delivery and retry recovery, private object access, secrets, origins/cookies, and environment isolation before the app can be described as deployable to Cloudflare. No Cloudflare account IDs, credentials, or Worker names are assumed.

Official capability references checked during this update: [Queues](https://developers.cloudflare.com/queues/), [Workflows](https://developers.cloudflare.com/workflows/), and [Hyperdrive](https://developers.cloudflare.com/hyperdrive/).

## Initial hosted setup recommendation (October 6, 2026)

Confirmed user constraints: existing Cloudflare account; no Workers yet; use default `workers.dev` URLs without a custom domain; no hosted PostgreSQL yet. The user authorized pushing the existing project to `https://github.com/igoramidzic/keycade`.

Recommendation pending database-provider selection: Neon managed PostgreSQL, starting with its Free plan for synthetic demo data, connected to the API/jobs Workers through Cloudflare Hyperdrive. Retain Drizzle and PostgreSQL 17 to match the tested local setup. Neon is a proposed provider, not a provisioned resource. Hyperdrive should use Neon's direct (non-pooled) endpoint; use separate migration/runtime credentials and disable query caching initially so grant revocations and recent mutations are observed immediately. Local Podman remains the local development database.

Proposed deployments retain separate bank-site, borrower, bank-console, API, and background-job boundaries. The frontends use Workers Static Assets and forward `/api/*` to the shared API through service bindings, so each browser app can use its own origin and host-only session cookie. Public UI URLs follow `<worker-name>.<account-subdomain>.workers.dev`; actual account subdomain and resource names must be discovered before deployment. The jobs Worker consumes durable work without a public job-submission endpoint. Neither a custom domain nor pre-created empty Workers is required to begin configuration.

Before the first hosted demo: implement and test the Cloudflare API entry point, event-driven background transport/outbox recovery, request-scoped database lifecycle, hosted public URLs/origins, and environment bindings. Preserve the local-only guards in `pnpm initialize`; hosted migrations need a separate explicit target and must not repurpose local initialization. Add R2 when document storage is implemented. Account creation, provider billing and cloud provisioning have not been performed by this recommendation.

Sources: [Cloudflare's Neon/Hyperdrive integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/), [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [default workers.dev URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), and [Neon's October 2 Free-plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project).

## Hosted account setup and CI ownership (October 6, 2026)

The user created Neon project `holy-fog-27591922` (Keycade), branch `production`, and explicitly selected PostgreSQL only, retaining Cloudflare R2 for future documents. The existing Neon CLI login works. Linking used `--no-env-pull --no-config`; Postgres credentials were subsequently pulled only into ignored `.env.neon` with mode 0600. A verified TLS query succeeded, and the local Podman `.env` remained byte-for-byte unchanged. No schema changes were applied manually.

The actual hosted project runs PostgreSQL 18.6, superseding the earlier suggested version 17. Keep the tested local 17.7 database and cover both versions in GitHub Actions before hosted migration; do not recreate the user's project merely to align versions.

The user's `cf` CLI login was verified directly. It is separate from Wrangler's login. The connected Cloudflare account uses `kualia-analytics.workers.dev`; existing unrelated Workers are outside Keycade's scope. No Keycade Workers, Hyperdrive or R2 resources were created.

The user requested that GitHub jobs own changes pushed to Neon. D01 adds a main-only, explicitly enabled migration job with encrypted environment credentials, exact target/TLS validation, migration-history checks, advisory locking, and PostgreSQL 17/18 validation. `neon deploy` manages Neon service policy and is unnecessary for this PostgreSQL-only setup; committed Drizzle migrations define the application's schema. Neon agent tooling and `neon.ts` are optional, not required for this database workflow.

The GitHub secret/environment setup attempt was blocked before execution by automatic approval review, which requires explicit approval to transfer this live database credential to GitHub. Deployment remains disabled until that approval and configuration; no secret or hosted migration has been sent by the setup attempt.

References: [Neon link](https://neon.com/docs/cli/link), [Neon env](https://neon.com/docs/cli/env), [Neon config](https://neon.com/docs/cli/config), [Cloudflare CLI login](https://developers.cloudflare.com/cf/get-started/), [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), and [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Standardize on PostgreSQL 18 (October 6, 2026)

After both PostgreSQL 17/18 CI jobs passed, the user requested updating local development to 18 and explicitly authorized wiping the existing local PostgreSQL 17 data. This supersedes the earlier plan to keep 17 locally or retain its data for rollback. Fresh local initialization and GitHub's database test job now target 18.6, matching Neon. The reset is a one-time authorized operation, not part of `pnpm initialize` or normal startup.

The PostgreSQL 18 image requires a named volume at `/var/lib/postgresql` with `PGDATA=/var/lib/postgresql/18/docker`. The new local volume is `${PROJECT_NAME}-postgres18-data`; checks enforce the configured image and data layout. Legacy explicit 17 configuration retains its old storage mapping but does not receive a separate CI matrix job. See the [official image layout](https://hub.docker.com/_/postgres).

## Approved GitHub migration activation (October 6, 2026)

The user explicitly approved storing the Neon database connection as an encrypted GitHub Actions secret, restricting deployment to `main`, and enabling migrations. This resolves the earlier approval block. The `neon-production` environment now permits only the `main` branch, contains `NEON_DATABASE_URL` as an encrypted secret and the exact target host/database as variables, and the repository variable `NEON_MIGRATIONS_ENABLED` is `true`. The setup verified these settings before enabling the workflow. Credentials were transferred via stdin to GitHub CLI's encrypted-secret mechanism and were not placed in source, process arguments, or tool output.

GitHub Actions remains the owner of hosted schema writes. Local setup performed no hosted migration. The first enabled workflow on `main` applied both committed migrations successfully; the next workflow run verifies idempotence. No change to the separate Cloudflare application deployment scope is implied.

## Faster demo deployment (October 6, 2026)

The user requested commenting out the separate tests to speed up deployment because this is a demo. The Neon workflow's PostgreSQL 18 validation job (checks, build and integration tests) and PR trigger are now commented out, and the migration job no longer depends on validation. The test source and local commands remain available. Workflow comments explain how to restore the job, PR trigger and dependency. This explicit CI exception supersedes the earlier requirement that hosted migration wait for full validation; it does not remove tests from implementation work.

Eligible `main` pushes and manual runs install the locked dependencies and go straight to migrations, with pnpm caching enabled. SQL execution still runs transactionally, and target/TLS checks, migration-history checks, serialization and GitHub's main-only environment remain in place. Valid SQL that breaks application behavior may reach the demo database without the paused regression checks.

## Cloudflare native Git deployment (October 6, 2026)

The user clarified their preferred workflow: connect the repository directly to Cloudflare and build/deploy when pushing to `main`. Use Workers Builds with Cloudflare's GitHub integration for application deployments. GitHub Actions continues to own Neon migrations. This does not require a Cloudflare deployment token stored in GitHub; Workers Builds supplies its own build authentication.

Connect `igoramidzic/keycade` to each of the three frontend Workers, the shared API Worker and the background-jobs Worker, with app-specific build/deploy commands and watch paths that include their shared package dependencies. The Worker entry points/configuration, Hyperdrive and queue bindings, hosted URLs and runtime adapters still need implementation before the first successful deployment. Grant the Cloudflare GitHub app access to this repository during setup if it does not already have access. Default `workers.dev` URLs remain selected; R2 waits for document uploads.

Cloudflare builds and GitHub migration jobs are independent triggers. The deployment slice must account for schema-dependent releases explicitly; do not assume GitHub migrations finish before a Worker deployment.

References: [Cloudflare GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/), [monorepo setup](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/), and [build configuration and authentication](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
