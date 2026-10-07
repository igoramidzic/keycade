# Decisions, assumptions, and reference sources

Baseline recorded October 6, 2026. Update this document when a future instruction changes an architectural or product assumption.

## Hosted demo intake configuration — October 7, 2026

The reported deployed intake 404 exposed missing operational configuration: the hosted database had no banks or products, although local initialization seeds them. Repair the hosted demo with an explicit, transactional, repeatable bank/product-only bootstrap, separate from schema migrations and full local fixtures. The bootstrap creates synthetic `bank-a` and its Synthetic Business Credit product without creating users, permissions, or applications or overwriting existing records. D02 dependencies are unchanged; its acceptance criteria now distinguish this explicit configuration from local fixture seeding. See [the verified recovery](tasks/D02-cloudflare-deployment.md#hosted-intake-recovery--october-7-2026).

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

## Concise setup questions and searchable NAICS — October 7, 2026

The user requested less text on setup question screens. Remove the progress disclaimer, routine question helpers, generic save instructions, idle “Saved to your application” status, and Continue later explanation. Keep the step indicator, actions, actionable saving/failure/unsaved states, and the concise amount range labelled “Financial Product.”

The industry picker should eventually be a searchable combobox with filtering inside the popup, similar to Spartan's interaction pattern. Keep React/shadcn as the implementation stack. T15 now owns hundreds of valid, versioned NAICS entries, fuzzy description/synonym/code search, and an evaluation of authoritative downloadable data or third-party search services. “Dentistry office” is an acceptance example. No provider has been selected or integrated in this change; the user explicitly allowed deferring this work to the existing later industry task. T15's dependencies are unchanged.

## Fixed Synthetic Business Credit — October 7, 2026

The user removed the Change Financial Product option and product choice entirely. This supersedes T07/T08's optional product question, product hints as a selection mechanism, summary product edits, and retired-product replacement flow. Public, borrower, and staff creation now default to their bank's latest active synthetic `business-credit` product. Explicit other-product requests are rejected (public starts retain their generic acknowledgment); later changes to the assigned product ID are rejected for borrowers and staff. Retrying a previously completed creation still returns its original assigned version.

Product records and versions remain for configured amount limits and historical requirements. Migration 0005 backfills eligible drafts within their own bank and converts legacy product steps to amount without marking setup complete or changing completed applications. Existing assigned business-credit versions stay pinned; they cannot be switched through setup. The UI always uses the five-screen path and contains no product controls, including when starting without a product hint. NAICS search remains deferred to T15 as previously requested.

## Borrower workspace summaries — October 7, 2026

T09 keeps the authenticated home as an explicit application selector, grouped by persisted business ID. Unlinked drafts stay separate even when their names match. Summaries show the pinned product name, exact decimal requested amount, lifecycle and last update; only loaded authorized applications are counted. Pending contact drafts still require an explicit claim before opening. No outstanding-task count or completion percentage is invented: the portal contract returns `remainingTasks: null` until T12.

The new portal summary API shares applicant setup guards in Fastify and the Cloudflare handler. Assigned-scope participants receive no requested amount or purpose in list, destination, portal, or the earlier application read endpoint. Their scoped entry bypasses the applicant wizard without granting access to tasks, documents or private data. Setup status controls completion badges independently of participant destination. Closed drafts show a terminal summary without a wizard/portal redirect loop.

Application routes and query keys preserve bank, user and application context. List and portal reads refresh on focus and every 30 seconds while visible; read preflight verifies that the cookie session still matches the query’s bank and email. Fresh destination checks precede routing, and errors hide stale private summaries. Task, document, people, activity and funded-account sections describe their unavailable features without invented records. No schema migration or hosted deployment is needed for this task.


## Staff workspace and local continuation — October 7, 2026

T10 uses page/limit pagination for the staff queue, with server-side search and stage/product/assignee filters, an allowlist of four sorts, and an application UUID tie-break. A repeatable-read transaction keeps rows and filtered counts consistent within each response; pages reflect current data and are not frozen across requests. Officers retain the existing bank-wide policy, including unassigned applications. Assignment does not grant or revoke access.

Internal notes have their own bank/application-scoped table with author and editor membership constraints. Assignment and note changes serialize on the application and advance its shared revision together with the setup revision. Stale edits require explicit reload/review. Audit rows record actor and changed field names, without copying note text. Participant listings show grants separately from contact verification and ownership. No notes or staff-only fields are added to borrower DTOs.

The staff creation transaction persists one targeted local continuation request, using the configured borrower origin and the existing durable identity delivery workflow. Creation retries return the original draft without another delivery request. The console saves optional prefill after creation and retains the created draft on prefill failure, making partial success explicit and retryable. Staff-prefilled answers still require the applicant to finish setup. Hosted staff creation returns an explicit delivery-unavailable response while hosted simulated email remains unconfigured. No hosted deployment or schema write is included in T10.


## Scoped collaboration and ownership — October 7, 2026

T11 records beneficial owners/contacts separately from accounts and application participation. Each relationship has a bank/business link and an application disclosure boundary, so a shared business does not reveal another application's people. General relationship DTOs contain no identifiers. Application administrators may delegate application-admin/full or owner/adviser/assigned roles; bank roles remain separate. Staff retain their bank-wide policy.

Invitations retain the initiating grant identity and update timestamp. Acceptance checks the exact verified email, invitation status/expiry, current initiating grant, and delegation scope inside the application transaction. A demo session never accepts an invitation. The T06 email delivery request is explicitly invitation-linked so mailbox verification cannot run the generic application-claim path. A subsequent deliberate acceptance applies the invitation only; repeated/concurrent acceptance is idempotent. Accepted invitation reads require current participation, and inactive previews hide live business details. Allowlisted invitation paths survive fresh email sign-in; the authenticated bank canonicalizes copied URLs. Consumed confirmation captures remain handled across UI remounts after sign-out. Resend queues a new delivery intent and revokes old links; removal revokes pending invitations addressed to the removed participant or created through their removed grant.

Task/document policy primitives are implemented now, including subject-private access restrictions. Actual resource grants remain empty until T12/T13 validate persisted resource identities and delegation authority. T11 removal clears scope lists and persists an unassignment marker; T12 must update unfinished assignments in the same revocation transaction and preserve authorship. Relationship changes must enter T12’s requirement reconciliation and later snapshot rules; this milestone does not implement those future workflows.

Invitation delivery is local-only through the existing Mailpit worker. Unconfigured delivery returns 503 before create/resend commits. The local and Cloudflare HTTP transports share the same services, but no hosted migration or deployment is part of this task.

## Task requirements and evidence policy (October 7, 2026)

T12 adds declarative demo requirement sets stored by bank, product, and policy version. Each application pins a copy when first reconciled. Existing applications reconcile on their first authorized dashboard/workspace read; subsequent relevant setup, purpose, owner, and participant changes reconcile in their writing transaction. Product edits do not silently replace an application's policy. Borrowers still receive the fixed Synthetic Business Credit product; a second synthetic product is exercised in backend tests, without restoring a product-selection screen.

Requirements have submission, approval, or closing stages and stable keys that include the owner relationship where relevant. A no-longer-applicable requirement is cancelled with history intact. Reapplication or changes to relevant input facts create a new occurrence with no answer or waiver reuse. Editing a completed or waived answer reopens the current occurrence; an assignee must submit again and staff must review again. Submitted/in-review/approved application facts stay locked to borrower evidence edits; closing-stage answers can be supplied during closing. Requirement-only stage evaluation is implemented, while checks, actual submission, and decisions remain T16/T19.

The initial answer adapter stores synthetic narrative evidence and immutable revisions. Private owner confirmation and business identifier-readiness answers accept only `confirmed` or `needs_help`; they never collect EIN/SSN values. Entity details and unresolved industry are later approval-stage requests, so they do not block minimal setup. Secure identifier capture remains with the later integration/field work; file and signature evidence adapters remain T13/T17.

Task lists, detail, history, and progress apply current participant scope and owner privacy on the server. Assignment grants access to that task, and invitation task grants are checked against current records at creation, resend, and acceptance. Only the current assignee submits; bank staff reviews, requests changes, or records a reasoned waiver. Participant removal unassigns unfinished tasks in the same transaction, retaining answer authorship and completed assignments; reinvitation does not restore those unfinished assignments. Every current assignment snapshots the participant’s revocation generation: historical completed/waived assignments remain records, but cannot regain read/edit authority after a restricted reinvitation. Explicit task-history grants permit reading without restoring assignment or submission rights.

Ownership and portal identity remain independent. An existing relationship can be linked once to a current participant in the same application; linking does not create a grant. Inactivating/restoring that relationship preserves its identity and historical evidence. Linking it to a different person is rejected; use a separate relationship for a different person. This prevents reassignment of private owner history. No hosted migration or deployment is part of T12.

## Borrower dashboard reference layout (October 7, 2026)

The user supplied `IMG_4765.HEIC` and explicitly requested a wider dashboard with tasks on the left and details on the right. Treat the image as a visual reference for layout and hierarchy. The borrower application landing page and Tasks route now share a wide desktop workspace: a larger checklist column with inline expandable rows, and a smaller application-details sidebar with amount, product, purpose, and current stage. Mobile stacks tasks before details. Application selection also uses the available desktop width; sign-in and the one-question setup retain a narrower form width.

Keep the required default shadcn styling. Group private/assigned tasks separately from shared business work, retain server-scoped visibility and synthetic labels, and protect unsaved entries when switching accordion rows. The reference's upload area does not advance T13; the sidebar explicitly states that uploads are unavailable. No fictional officer contact details are added. This is a visual follow-up to T09/T12, with their existing prerequisites; T13 remains the next implementation task.

## Document upload implementation boundary — October 7, 2026

T13 uses private local file storage for the demonstrated upload milestone. Both Node and native Workers HTTP handlers share the same authorization/services and are covered by PostgreSQL transport tests; the deployed Workers still require an R2 binding and hosted storage verification before uploads can be claimed available there. No public file URL or local-filesystem assumption is introduced into domain services.

The document version is the transactional upload reservation and scan intent. The local worker claims due scans using PostgreSQL leases and generation tokens, retaining safe retries and avoiding file/identifier content in queue payloads. Staging is cleaned after interruption or expiry, and immutable publication prevents concurrent retries from changing stored bytes. Production malware scanning and full document-format sanitization remain outside this simulated release.

Source references: [Fastify streaming content parsers](https://fastify.dev/docs/latest/Reference/ContentTypeParser/) and [Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). Industry search source evaluation is recorded in [NAICS sources](naics-source.md).

## Document interpretation and enrichment checkpoint — October 7, 2026

T14 records clean-scan interpretation intent through a transactional outbox, with version-bound run generations, expiring leases and separately audited manual category corrections. Provider suggestions remain unconfirmed evidence; neither classifications nor extracted values complete tasks or alter application facts. Category counts and suggested task titles follow the same backend permissions as the underlying resources.

T15 selects the complete 1,012-entry U.S. Census 2022 six-digit NAICS catalog for deterministic local search; [the source evaluation](naics-source.md) records the download, licensing basis, checksums, commercial alternative and explicit update policy. The saved version is `2022`. Broad historical demo answers stay readable but require a precise new selection or Skip when edited.

Private identifiers use immutable AES-256-GCM versions, a generated local key and authenticated bank/application/subject/revision context. Only the registered synthetic namespace `000000001`–`000000007` is accepted. Enrichment run rows serve as transactional durable work intent with bounded retries and leases; workers load identifiers by authorized reference, and no raw identifier enters a job, audit event or result. An identifier replacement clears tax authorization and invalidates prior runs. Tax authorization uses explicit demonstration text and does not claim a legal consent standard or access to real records. Suggested facts require a separate explicit confirmation record and never overwrite user-entered application facts. T16/T19 must apply the unified material-edit and frozen-snapshot policy when adding checks and decisions.

The private R2 bucket is provisioned with its managed public URL disabled. The adapter/native worker path is tested locally in workerd, and the API/jobs deployment dry runs pass. No new hosted deployment or hosted document/enrichment acceptance is claimed here; the deployed enrichment environment still lacks its encryption key. These local milestones preserve the explicit hosted-validation boundary.

## Immediate task expansion and dashboard surfaces — October 7, 2026

The user requested all tasks up front and a clearer visual hierarchy with fewer card outlines and horizontal rules. T12's list response now includes full details for permitted tasks using batched history queries. Both dashboards preload permitted document metadata at the same time; task expansion is a local selection rather than a fetch. The selected detail remains an editing snapshot so background polling cannot replace an unsaved answer; explicit reload and current server mutation guards remain authoritative.

Use the existing shadcn neutral palette: muted page background, white primary task/details panels, spacing between rows, and subtle expansion/selection surfaces. Remove redundant nested containers and separators, and leave the document shortcut unboxed. This refines T09/T12 without changing their dependencies or the default component styling.

## All environments are demos — October 7, 2026

The user explicitly clarified that the whole application, including the production deployment, is a demo and should work like local. This supersedes earlier decisions that disabled hosted demo entry or treated missing hosted email as an acceptable final boundary. Never infer real authentication, real email delivery, real provider verification, signatures, lending decisions or money movement from deployment to production.

The reported hosted failure is `AUTH_DELIVERY_UNAVAILABLE`: “Email sign-in is available in the local demo. Hosted email delivery is not configured.” [D03](tasks/D03-hosted-demo-parity.md) will replace this blocker with explicitly simulated hosted access/delivery and synthetic fixtures. Preserve current bank/application/resource authorization, session/CSRF/revocation controls, safe demo labels and retry/idempotency behavior. The local Mailpit workflow and hosted simulated inbox/access path must exercise the same application journeys; neither sends external email. This instruction records the correction now; D03 remains unimplemented until its hosted acceptance checks pass.


## Checks, signing and notification policy — October 7, 2026

T16 uses immutable synthetic input generations and required approval-stage identity/fraud policies. Missing identifiers never prevent minimal intake. Secure input tasks use encrypted identifier/explicit authorization endpoints; generic answers, reviews and signatures cannot substitute for these inputs. Material input changes are frozen during submission/review and later decisions. Only a successful current `needs_review` check permits the configured, audited human resolution; failed, stale, unknown and unable-to-verify results remain blockers.

T17 envelopes bind a current immutable clean document version, task policy and intended participant grants. Completion requires every intended signer and publishes one clearly synthetic artifact/task evidence record. Source replacement and access changes invalidate applicability. A purpose-derived HMAC verifies exact raw callback bytes; simulated browser signing still requires a protected current intended-signer session.

T18 persists meaningful applicant inactivity independently from background/staff updates. Default reminders are due at 24 and 72 hours, at most two per episode; a first scheduler visit after 72 hours sends only the later reminder. Current activity, access, recipient verification, lifecycle and opt-out are rechecked before delivery. Existing SMTP crash ambiguity retains a stable message ID and replay-safe sibling credentials. Local links use the API's primary loopback origin consistently. Status-change intent is available for T19 to call transactionally; its absence before lifecycle implementation is explicit. All hosted email remains simulated under D03.
