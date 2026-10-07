# Neon PostgreSQL and GitHub Actions

The existing Neon project `holy-fog-27591922` (Keycade), branch `production`, is the hosted database. It runs PostgreSQL 18.6. Local Podman also uses 18.6 after the user explicitly authorized wiping the initial local 17 database and starting fresh. GitHub's PostgreSQL 18 validation job is preserved but commented out for faster demo deployment. Neon is used only for PostgreSQL. Cloudflare R2 remains the planned document store.

## Local connection context

The Neon CLI login and a TLS-verified, read-only SQL query were verified. `.neon` pins the project and branch; `.env.neon` holds private connection strings with owner-only file permissions. Both files are ignored. `.env` still belongs to local Podman and was unchanged by setup.

To link a fresh checkout without overwriting local development settings:

```sh
neon login
neon link --project-id holy-fog-27591922 --branch production --no-env-pull --no-config -y
neon env pull --service postgres --file .env.neon
chmod 600 .env.neon
```

Use the direct `DATABASE_URL_UNPOOLED` connection for migrations and later Hyperdrive setup. Do not copy hosted values into `.env`, run local initialization against Neon, or commit credentials. `neon.ts`, `neon deploy`, and a Neon uploads bucket are unnecessary for PostgreSQL-only hosting: Drizzle owns schema changes.

## GitHub setup

The workflow is `.github/workflows/neon-database.yml` in `igoramidzic/keycade`. The user explicitly approved transferring the Neon connection into an encrypted GitHub Actions secret and enabling migrations. The deployment environment and exact target variables have been configured and read back; the repository enable flag is `true`.

Hosted execution is verified: the [first enabled run](https://github.com/igoramidzic/keycade/actions/runs/37559188611) applied two migrations; the [migration-only demo run](https://github.com/igoramidzic/keycade/actions/runs/37559774548) completed in 18 seconds with zero pending migrations and two total.

Configured settings:

| Setting | Location | Value |
| --- | --- | --- |
| `neon-production` | GitHub deployment environment | Allow only the `main` branch; no tags |
| `NEON_DATABASE_URL` | Environment secret | Direct migration connection string; encrypted by GitHub CLI before upload |
| `NEON_DATABASE_HOST` | Environment variable | Exact direct database hostname |
| `NEON_DATABASE_NAME` | Environment variable | Exact database name |
| `NEON_MIGRATIONS_ENABLED` | Repository variable | `true` only after the environment, branch restriction, secret and target variables are verified |

The database secret is exposed only to the final migration step. Dependency installation does not receive it. The migration credential is for schema administration; future application Workers should use a separate runtime credential. No account-wide Neon API key is needed for this workflow.

## Normal operation

1. Change the Drizzle schema and generate a new committed migration with `pnpm db:generate`. Keep already-applied migration SQL unchanged.
2. Push to `main`. Changes to database files, local database configuration, the migration runner, workflow or dependency manifests trigger deployment. The separate test/build job and PR trigger are commented out at the user's request for the demo; local test commands remain available.
3. With deployment enabled, GitHub installs dependencies from the lockfile and runs `pnpm db:migrate:neon` directly. It serializes deployments, validates the exact TLS database target, checks migration history, and transactionally applies only pending SQL. It does not seed data or reset schemas.
4. To retry, use **Actions → Neon database migrations → Run workflow → main**. Reapplying the same committed migrations is a no-op. The command refuses ordinary local execution.

Pull requests do not run this workflow while demo validation is paused. Manual runs on another branch cannot deploy. A divergent or ahead-of-checkout migration history fails rather than attempting a rollback. With GitHub's concurrency queue, a newer pending run may replace an older pending run; the latest commit contains the cumulative migration history.

To restore pre-deployment validation, uncomment the `pull_request` trigger and `validate` job, and restore `needs: validate` on `migrate`. That job runs checks, builds and integration tests on disposable PostgreSQL 18 databases without hosted credentials.

This workflow is path-filtered. If it becomes a required pull-request status check, use an always-running dispatcher or remove the path filter so unrelated changes do not wait forever for a skipped check.

Cloudflare deployment remains separate: this workflow does not create Workers, Hyperdrive, Queues or R2, deploy application code, or initialize the local pg-boss transport remotely.
