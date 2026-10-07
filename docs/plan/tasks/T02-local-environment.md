# T02 — Podman, environment files, and local commands

Dependencies: T01. Read [development contract](../05-development-and-testing.md).

## Outcome

A developer can initialize local infrastructure and launch every shell with a verified database connection.

## Scope

- Add project-owned Podman PostgreSQL and Mailpit definitions with persistent DB storage, loopback ports, and configurable names/ports.
- Implement prerequisite checks, including Podman machine handling on macOS and compose-provider detection if used.
- Implement `pnpm initialize`, tracked env templates, generated missing secrets, and untracked private data paths. Preserve existing values.
- Add DB/infra start, stop, status commands and root dev orchestration. Before Turbo starts apps, perform bounded authenticated SQL readiness checks.
- Add central server env validation and browser env allowlisting. Set up frontend `/api` proxies and documented port defaults.

T03 connects initialization's migration/seed phases and schema-version readiness. Until T03, report that no application schema has been introduced; do not pretend a seed or migration ran. T05 connects queue initialization and worker readiness.

## Acceptance criteria

- `pnpm install` followed by `pnpm initialize` generates missing env files and starts accessible PostgreSQL/Mailpit.
- A second initialize reuses healthy project-owned resources and preserves an edited env value and a test database record.
- `pnpm dev` launches the shells only after a successful SQL query using the configured credentials and database.
- Bad credentials, unrelated port occupants, missing Podman prerequisites, and unavailable DB fail with bounded waits and useful instructions, without secrets in output or disruption to unrelated services.
- An unfamiliar/remote database target is rejected before automatic initialization or seeding can mutate it.
- Stopping containers preserves the volume; startup never resets it. Ctrl-C terminates app child processes.

## Validation

Exercise first setup, repeated setup, stop/start, bad credentials, and missing prerequisite handling. Use an isolated temporary configuration for destructive test scenarios; never reset the developer database. Verify private env files and uploads are ignored by Git.

## Implementation record

Done — October 6, 2026. Native Podman definitions live in `scripts/local-lib.ts` with configurable image/name/port defaults in `.env.example`; no Compose provider is needed. Setup uses explicit ownership labels, loopback ports, persistent storage, bounded authenticated SQL, restrictive env permissions, and guards against unfamiliar database targets and remote Podman overrides. A missing macOS Podman machine produces an explicit `podman machine init` instruction; existing configured machines start automatically.

Validation: first `pnpm initialize` and repeated initialization succeeded. `pnpm exec tsx scripts/verify-local.ts` confirmed environment bytes and a temporary synthetic bank record survive initialization and database stop/start; the probe removed only its own row afterward. Wrong credentials and a stopped DB both caused `pnpm dev` to fail before launching applications. Unit tests cover edited/blank/empty env files, stable secrets, file modes, remote/mismatched database targets, unrelated port occupants, missing/hung prerequisites and Podman routing overrides. `git check-ignore` confirms `.env` and private storage are ignored. Full dev launched all five apps; Ctrl-C released every app port. An `API_PORT=4100 pnpm dev` run verified readiness on 4100 and through all three frontend proxies, proving overrides survive Turbo's strict environment boundary.

Migrations/seeds and queue initialization are connected through T03/T05. The complete command results are in [the milestone validation record](../local-foundation-validation.md).
