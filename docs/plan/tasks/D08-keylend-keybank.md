# D08 — KeyLend and Keybank identity

Dependencies: T01, T03, T06, T08, T10, D02, D07. User-requested follow-up, October 13, 2026.

## Outcome

KeyLend is the project/application name and `@keylend/*` is the workspace namespace. Keybank is the only supported bank. This is an internal Keybank tool with borrower-facing intake and task views; it is not offered to other institutions. All environments remain synthetic demos under D03/D07. The existing red, charcoal and neutral palette remains, with a key symbol replacing the old arcade/arch motif.

## Acceptance criteria

- Product names, browser titles, generated sample documents, new provider identifiers, workspace imports, lockfile, scripts and Worker configurations consistently use KeyLend/Keybank.
- The borrower and lender portals always select Keybank. Public intake, synthetic sign-in and staff-account discovery reject unsupported bank slugs; public application start retains its neutral acknowledgement while creating no unsupported-bank draft. Backend application, membership and document restrictions remain enforced.
- Normal initialization seeds only Keybank. Additional isolation fixtures are opt-in and permitted only in disposable test databases.
- An additive migration renames the existing synthetic bank in place, preserving application IDs, participation and immutable evidence. Applied historical migrations are never rewritten. Repeated migration and seed runs preserve saved records.
- Existing encrypted identifiers/inbox messages, registered sample PDFs and persisted provider results remain readable. No historical evidence is rewritten to erase branding.
- All five Worker configs and navigation origins target `keylend-*`. Keep existing private storage, queue, Hyperdrive and encryption bindings; renaming the app must not replace documents, keys or pending jobs.
- Verify unit, database, desktop/mobile, workspace builds/types and native Worker builds. Record live configuration verification separately from app publication.

## Implementation record

Done locally — October 13, 2026. The user renamed all five live Workers while this task was running. Their immutable Worker IDs, service dependencies and jobs queue consumer were verified. The API/jobs origin variables still pointed at the former domains; those variables were corrected. The three frontend build triggers now use `@keylend/*` package filters. No Worker code or frontend asset publication was performed by this task.

Migration `0025_keylend_keybank.sql` changes the primary synthetic bank's name/slug and renames the immutable-financial-record trigger function. It does not replace bank IDs, applications, memberships, documents, financial facts or funded records. The migration is applied locally; the hosted database migration and application publication remain pending.

### Compatibility exceptions

Remaining legacy strings are intentional and bounded: applied migration SQL, encrypted v1 associated data/key derivation, accepted historical provider values, exact-byte historical PDF recipes, persistent pg-boss/Podman ownership labels, the existing runtime database login, Cloudflare queue/R2/Hyperdrive names, and actual GitHub repository/history URLs. New samples and provider outputs use KeyLend. The checkout and GitHub repository have not been renamed. Existing secondary-bank rows are retained for data integrity but are not available through normal portal entry, public intake or synthetic sign-in. Disposable tests retain an explicitly named isolation fixture to continue verifying access boundaries.

### Validation record

- `pnpm check`: lint, credential boundaries, all 12 workspace typechecks/root TypeScript and **435 unit tests** pass.
- `pnpm test:integration`: **492 PostgreSQL cases in 51 suites** pass. A subsequent targeted upgrade/seed run adds the branding-upgrade case and passes **10 cases**, including prior-schema migration, repeat migration and retained application/participant rows. All **33 setup PostgreSQL cases** also pass after the final public-start guard, including unsupported-bank acknowledgement without draft creation.
- Entry, foundation and intake browser coverage: **38 distinct desktop/mobile cases** pass across the main run and corrected account-selection recheck. The initial run passed 37/38; one test navigated before sign-out completed. Waiting for the signed-out form fixes it, and both viewports pass on recheck.
- `KEYLEND_DEPLOYMENT=cloudflare pnpm build`: all 12 workspace builds pass. Native Wrangler dry runs pass for API, jobs and all three frontends.
- Local migration succeeds without reset. Live Cloudflare names/bindings/origins/build filters were read back. All three renamed frontends return HTTP 200, and the renamed live API returns readiness 200 with database and worker ready. Desktop/mobile setup screenshots were visually inspected. Hosted Keybank content has not been claimed verified; it requires publishing this source and applying migration 0025.
