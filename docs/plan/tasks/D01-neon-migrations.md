# D01 — Neon connection and GitHub migrations

Dependencies: T03, T05. Read [architecture](../02-architecture.md), [decisions](../06-decisions-and-sources.md), and [hosted operation](../../../infra/neon.md).

## Outcome

GitHub Actions owns application schema updates to the user's existing Neon PostgreSQL project. Local development continues using Podman. This user-requested deployment slice is separate from the T06–T10 product milestone.

## Acceptance criteria

- Existing project `holy-fog-27591922`, branch `production`, is linked and read-only TLS connectivity verified; local `.env` is preserved and credentials remain ignored.
- Neon is PostgreSQL-only; no Neon uploads bucket or additional service is provisioned. Cloudflare R2 remains the planned document store.
- Pull requests validate without hosted credentials. Only `main` pushes or manual runs can apply migrations, after unit/type/build and real PostgreSQL 17/18 checks pass.
- The explicit hosted command requires GitHub Actions and validates direct endpoint, expected host/database, and TLS. It never invokes local initialization, seeds, resets, or background transport startup.
- Concurrent migrations serialize. Repeated runs do nothing; edited historical migrations and a database ahead of the checkout fail safely, with no secret or raw SQL error exposure.
- GitHub's `neon-production` environment restricts deployment to `main`, stores the connection as an encrypted secret, and passes it only to the migration step.
- The first GitHub-hosted migration and a repeated run pass before this task is marked complete.

## Implementation record

In progress. The existing Neon login, project link and read-only TLS connection passed; PostgreSQL reports 18.6 and an initially empty public schema. The local `.env` hash was unchanged. Both `.neon` and `.env.neon` are ignored; `.env.neon` has mode 0600.

Cloudflare `cf auth whoami` confirms a valid CLI login; this is the newer `cf` CLI, whose login is separate from Wrangler. The account's existing subdomain is `kualia-analytics.workers.dev`; no Keycade Workers exist.

Hosted execution remains disabled with `NEON_MIGRATIONS_ENABLED` until the GitHub credential setup is approved. Automatic approval review rejected transferring the live Neon database credential to GitHub and creating deployment settings without explicit authorization for that credential transfer. The rejected command did not execute. Complete local/CI validation before requesting that final approval.

Validation before push:

- `pnpm check` passed: Biome, browser/server package boundaries, all workspace/root type checks and 94 unit tests (including 42 new hosted-migration tests).
- `pnpm build` passed all 12 packages.
- Six new integration tests passed on disposable local PostgreSQL 17 databases: initial application without seeds, repeated migration preserving records, wrong database rejection, altered SQL/timestamps and older-checkout rejection, concurrent migration locking, transactional failure rollback and lock release.
- All 145 candidate tracked/untracked source files were scanned against actual local/hosted private environment values with no matches. Git confirms `.env.neon` and `.neon` are ignored.
- GitHub's PostgreSQL 17/18 workflow run remains to be recorded; no remote migration has run.
