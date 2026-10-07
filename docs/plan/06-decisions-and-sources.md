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
| Required resumable setup wizard before the borrower task portal | Explicit user clarification, October 6, 2026: one simple question at a time, saved state, and completion before entering the portal. Planned in T07–T09; see the decision below. |
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

The user's `cf` CLI login was verified directly. It is separate from Wrangler's login. The connected Cloudflare account uses `kualia.workers.dev`; existing unrelated Workers are outside Keycade's scope. No Keycade Workers, Hyperdrive or R2 resources were created.

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

## Cloudflare resources and native adapters (October 6, 2026)

The user created all five Workers/build triggers and explicitly authorized creating Hyperdrive and the remaining Neon connections. Wrangler 4.148.0 and its lockfile dependency repair the missing CLI failure. The newer `cf` CLI is beta (1.0.0-beta.12 at setup), useful for resource management; Wrangler remains the supported build/deploy tool.

`keycade-db` Hyperdrive connects directly to Neon using `keycade_runtime`, with TLS required, query caching disabled and an origin connection limit of five. GitHub configured this login with application DML and migration-history reads, without schema/role administration or audit update/delete privileges. Runtime credentials remain ignored locally and encrypted in GitHub/Cloudflare. The approved one-time runtime setup flag is disabled after the successful GitHub run; normal migrations do not rotate the password. Future tables inherit runtime privileges through the migration owner's default grants. New audit-style tables require explicit restricted grants.

Cloudflare Queue `keycade-jobs`, event-scoped connections and a minute recovery Cron replace the hosted persistent Node poller. The local pg-boss adapter retains its behavior. Workers use the same portable operation processor and transactional outbox logic. R2 remains deferred until T13 because no document storage is used yet.

A real Workers-runtime probe found that Fastify's routing dependency calls `new Function`, which Workers disallow. The hosted API therefore uses a small native HTTP transport, preserving existing Zod wire contracts and domain authorization. Fastify remains the local transport. This supersedes the assumption that Fastify itself could run in the hosted Worker; T06 and subsequent HTTP tasks must cover both transports. The alternative of enabling runtime code generation is not required.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Cloudflare CLI](https://developers.cloudflare.com/cf/), [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/), [Hyperdrive with Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/), and [Queues](https://developers.cloudflare.com/queues/).

The user changed the account subdomain to `kualia.workers.dev` during deployment setup. Hosted public URLs and allowed origins use that subdomain.

## Passwordless access test slice (October 6, 2026)

The next-feature request selects T06 as a coherent test point before T07 application creation. Generic sign-in creates only pending contacts and access-delivery intent; it never creates applications or grants participation. Both HTTP transports share the same identity service, origin policy, hashed credentials, database-backed rate limits, and live membership checks. The local Vite proxy preserves the configured frontend Host for same-origin session reads. Each frontend origin has its own cookie name so local borrower and staff sessions can coexist across ports.

Access-delivery requests serve as the transactional identity outbox. pg-boss receives only a delivery-request ID. The local worker claims a request, persists the new token hash, and sends through loopback SMTP to Mailpit. A lease recovers ambiguous SMTP acceptance; retry-issued sibling tokens share atomic consumption/revocation. Links expire after 15 minutes, delivery requests after one hour, sessions after eight hours. A credential is carried in the email URL fragment, removed from browser history on page load, and consumed only by an explicit POST. Only `/` is an approved return destination in this slice.

The existing hosted foundation has no email sink and no seeded banks/users. This slice does not provision a public inbox, send real email, seed Neon, or deploy. Hosted request-link returns an explicit delivery-unavailable response and the UI explains that email sign-in is local. Hosted session/CSRF behavior is covered by the native transport tests; hosted end-to-end sign-in requires a separately configured simulated delivery destination. Application intake and workspaces remain T07–T10.

The SMTP adapter follows [Nodemailer's SMTP transport options](https://nodemailer.com/smtp), with fixed loopback destination, bounded timeouts, and protocol/content logging disabled. Browser authentication tests disable traces/screenshots/video to avoid retaining credentials from the local inbox.

## Immediate demo sign-in (October 6, 2026)

During T06 testing the user explicitly requested entering an email and signing in immediately, without visiting the inbox. This overrides email verification as the default local demo entry path. The local development API enables a visibly labelled demo sign-in endpoint; both the default production configuration and hosted Worker leave it disabled. The endpoint requires a synthetic bank and synthetic user, preserves explicit staff membership and application grants, and uses the same origin, CSRF, rate-limit, cookie, expiry, and revocation controls.

Sessions record `authenticationMethod` as `demo` or `email_link`. Demo sign-in does not mark an email verified, consume or mint an email token, queue an email, or create an application. Its actor is restricted to the selected demo bank. Disabling demo mode rejects existing demo sessions. UI copy says **Demo access**, never **Email verified**, for that method. The email-link flow remains available as a secondary option for exercising T06's single-use/recovery behavior. T07 must allow the explicitly authorized demo actor for synthetic draft workflows while retaining actual email verification for the email-link path.

## Required initial setup before the borrower portal (October 6, 2026)

The user clarified that borrowers need a dedicated page to set up a loan application through a wizard that asks simple, single questions one at a time, tracks state, and can be resumed. Borrowers must finish that process before entering the portal to see their remaining tasks. This replaces the earlier loosely defined short-form-to-workspace handoff.

The plan implements this as per-application setup with database-persisted answers, current/completed/skipped steps, revisions, and explicit completion. The initial questions remain business name, amount, purpose/product, and optional industry; identifiers, evidence, signatures, and checks stay in later tasks. Back/Continue, optional Skip, a setup-only step indicator, save feedback, and a final summary/“Finish setup” action keep the process understandable. Server validation and an atomic, idempotent completion command unlock the applicant portal; sign-in or a direct URL cannot bypass setup. Both permitted local demo access and verified email-link access follow this rule.

Implementation defaults: the gate applies to each application independently; a minimal selector can route unfinished drafts to setup without blocking an already completed application. Staff can inspect/prefill a draft, but the applicant must confirm and finish setup. Owners/advisers keep their separate scoped invitation/task journeys. Setup completion transitions the draft to information collection; it is not submission, approval, funding, or completion of later requirements.

T07 owns persistence and domain guards, T08 the wizard, and T09 the portal handoff. The existing T07 → T08 → T09 dependencies remain valid; T10 still depends on T07 for staff progress/prefill. T18 continuation links resolve current setup state; T19 submission requires completed setup; T22 verifies the combined journey. This request updates instructions only. These features remain not started, with acceptance criteria and planned validation updated rather than marked implemented.


## Application setup backend — October 7, 2026

T07 implements setup definition version 1 with stable `business_name`, `product`, `amount`, `purpose`, `industry`, and `review` keys. Canonical initial answers are stored on the application, so editing one draft never silently changes another application's business facts. An explicitly authorized staff-selected business may be referenced; otherwise finishing setup creates a new business without matching on name or identifiers. Application and setup revisions advance together. Product changes invalidate amount-step validation; final confirmation always revalidates required answers against the current configured product limits.

Public email-start uses a random 256-bit hexadecimal idempotency key as an opaque request context, stores only its hash and the payload hash, and always returns a generic acknowledgment for unknown bank/product or throttled starts. The key is never application authorization. Authenticated create/finish keys are UUIDs scoped to operation, actor, and bank. A changed payload conflicts; failed transactions reserve no key. Stable list pagination uses ascending application UUIDs and an `after` UUID cursor.

A targeted continuation link claims only its intended contact draft. Fresh generic sign-in lists existing grants and pending contact drafts in the selected bank for explicit claim; it neither creates an application nor accepts unrelated invitations or restores revoked access. Demo actors remain restricted to synthetic users, banks, contacts, and applications, and demo creation/claim/completion is recorded without mailbox verification.

Migration 0004 preserves existing drafts as incomplete. Historical applications already beyond draft retain portal access using their existing update timestamp, without inventing a completion actor. New completion records always include the confirming applicant. Fresh synthetic seed fixtures include two completed applications and three incomplete drafts; reseeding never overwrites existing records or progress.

The completion transaction records setup, lifecycle, business creation if needed, audit, and idempotency together. It creates no provider job because T07 has no background completion effect; T12 owns requirement reconciliation and its transactional job intent. Public creation does persist the existing durable access-delivery intent atomically. T08/T09 own the wizard screens and portal routing; T10 owns the staff creation screen and sending its continuation message. This backend change is locally validated, with no hosted migration/deployment performed.

## Bank intake and setup screens — October 7, 2026

T08 implements the separate mock bank and borrower entry. Public bank/product hints are validated through a read-only catalog in both HTTP transports. The catalog advertises the latest active version per product slug; authorized setup responses additionally carry the persisted product's descriptor, so an older draft retains its actual name and limits. A retired product can be replaced through a narrowly validated navigation-only update before any new answer or completion is accepted.

The borrower uses React Router, TanStack Query, and React Hook Form with default shadcn components. New starts require an explicit action and retain request keys across retries. Generic sign-in never creates another draft. The server owns saved answers, revisions, progress, and the setup/portal destination. Browser storage is unused. Unsaved answers can survive same-tab reauthentication in a bank/user/application-scoped in-memory buffer, cleared on successful explicit sign-out; closing that tab preserves only acknowledged server saves.

The wizard asks business name, product when needed, exact amount, purpose, and optional industry, followed by explicit review/finish. A small visibly synthetic industry fixture remains until T15. Product corrections revalidate amounts. Revision conflicts require review before retry; fresh server navigation takes priority over stale local steps. Session preflight rejects actor changes in another tab. Setup completion opens an honest handoff page, with the full dashboard and remaining-task navigation still owned by T09. T08 introduces no database migration beyond T07 and performs no hosted deployment.

The complete browser suite exceeds intentional per-IP rate windows when sent as one burst to a shared developer API. Its default runner now creates a disposable PostgreSQL database, starts owned processes on free ports, and runs sequential test shards. Between shards it restarts only its API and expires only that generated database's counters. This keeps runtime throttles intact, provides reproducible verification, and avoids mutating or stopping the developer's application/database. The shared Mailpit inbox is preserved; test messages use synthetic addresses.
