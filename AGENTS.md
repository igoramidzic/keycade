# Working on Keycade

## Start here

- Read [docs/plan/README.md](docs/plan/README.md), then the selected task and its linked reference documents.
- The repository was created as a planning-only deliverable. Start implementation when the user requests it; do not treat the existence of this backlog as an instruction to build every task.
- The user's latest explicit instructions take precedence over this plan. Record material changes in [decisions](docs/plan/06-decisions-and-sources.md) and update affected task dependencies and acceptance criteria.
- When implementation is requested without a task number, choose the first unfinished task whose dependencies are complete. Keep the change reviewable and demonstrate its acceptance criteria.

## Required direction

- Use TypeScript, pnpm workspaces, Turborepo, React, Node.js, PostgreSQL, Drizzle ORM and Drizzle Studio, Biome, Tailwind CSS, and shadcn/ui themed by the Keycade design system (tokens and composed primitives in `packages/ui`; see its README). The user replaced default shadcn styling with this design system on October 8, 2026.
- Add shadcn components through the `npx shadcn@latest` CLI as requested. Keep pnpm as the repository package manager and maintain one pnpm lockfile.
- Use Podman for the local database. `pnpm initialize` must be repeatable; `pnpm dev` must verify an actual database connection before starting development processes.
- Follow the local Fastify API and worker architecture unless a subsequent decision changes it. Keep database and integration credentials out of browser packages.
- Cloudflare hosts the deployed demo through five Workers. The Node/pg-boss worker is local infrastructure. Keep domain rules and transactional intent separate from runtime adapters, and validate a Cloudflare deployment slice before claiming hosted compatibility.
- The entire application is a demo in every environment, including production. Hosted behavior must match the local demo: use simulated authentication/access and email delivery, synthetic users/data, and fake external providers. Do not add real authentication providers, send real email, or perform real financial/identity/signature operations on production. Use neutral product wording per the October 9 override in D07; keep backend simulation markers and bank/application/resource access guards. Hosted demo parity, including `AUTH_DELIVERY_UNAVAILABLE`, is tracked in [D03](docs/plan/tasks/D03-hosted-demo-parity.md).
- Use configurable asynchronous delays for demos and injected clocks for tests. Never interpret the word production as authorization to enable real external services.
- First-release scope is applications through funding. Repayment schedules, balances, payment collection, interest, and collections are deferred by the user's explicit choice.
- Borrowers must finish a dedicated, resumable initial loan-application setup wizard before entering that application's task portal. Ask one simple question per screen, persist answers and progress on the server, and return unfinished applicants to their saved step. Enforce setup completion in backend workflow guards; see [the borrower journey](docs/plan/01-product.md#initial-setup-wizard-and-portal-entry).

## Implementation discipline

- Enforce bank boundaries, application participation, and restricted task/document access in the backend. Hiding a control is not authorization.
- Keep beneficial ownership separate from permission to use the portal. Keep applications separate from funded loan accounts.
- Persist changes and job intent transactionally. Make background effects retryable and idempotent; ignore results for stale inputs.
- Never treat a simulated check, extracted document value, or signature as a real financial or identity determination.
- Add schema changes with committed Drizzle migrations. Never make a destructive reset part of ordinary initialization or development startup.
- Add appropriate tests alongside behavior. Use real PostgreSQL for database and isolation checks; do not defer critical tests to the final milestone.
- Do not commit secrets, real financial records, or identifiers. Log safe metadata rather than raw documents, authentication links, EINs, or SSNs.
- Update the task status in the [plan index](docs/plan/README.md), record validation in the task file, and keep the [requirement map](docs/plan/07-requirements-map.md) accurate. Do not mark work complete if its acceptance criteria are unverified.

## Reference documents

- [Product and user journeys](docs/plan/01-product.md)
- [Architecture and repository layout](docs/plan/02-architecture.md)
- [Domain, states, and access rules](docs/plan/03-domain-and-access.md)
- [Integrations and background jobs](docs/plan/04-integrations-and-jobs.md)
- [Local development and testing](docs/plan/05-development-and-testing.md)
- [Decisions, assumptions, and sources](docs/plan/06-decisions-and-sources.md)

Do not assume that a command described in these documents exists until its implementation task has been completed.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
