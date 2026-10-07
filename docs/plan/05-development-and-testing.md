# Local development and verification

The command inventory is implemented for T01–T08. Passwordless identity is locally testable through [the identity guide](identity-validation.md); application creation and setup APIs are verified in [T07](tasks/T07-application-service.md#validation). The bank → setup → completion handoff is verified on desktop and mobile in [T08](tasks/T08-intake.md#implementation-record); later task-portal journeys remain planned. See the root README for the current startup path.

## Developer entry path

Document prerequisites: a pinned Node LTS release, the pinned pnpm version, Podman, and its compose provider if the implementation uses compose. Diagnose missing tools with installation links. Do not install global tools or change the user's shell configuration silently.

From a clean checkout, the intended sequence is `pnpm install`, `pnpm initialize`, then `pnpm dev`. Initialization may delegate to workspace scripts but should be the only setup command after dependencies are installed.

### Initialization contract

`pnpm initialize` must:

1. Validate runtime/package-manager versions, Podman availability, machine/engine readiness, and required ports. Reuse healthy project-owned resources; report unrelated port occupants without stopping them.
2. Generate missing local environment files from tracked templates, including local secrets and private storage paths. Preserve existing values and report missing keys rather than overwriting them. Keep files untracked and secret files restrictive.
3. Start project-owned PostgreSQL and Mailpit resources through Podman. Use a named persistent database volume and avoid interfering with unrelated containers.
4. Perform bounded retries with an authenticated `SELECT 1` against the exact configured database. A running container or an open TCP port is not enough.
5. Confirm the target is the recognized project-owned local database before any database mutation. Refuse automatic initialization/migration/seeding of an unfamiliar or remote target. Then apply committed Drizzle migrations, initialize the queue according to its supported lifecycle, and seed synthetic data idempotently.
6. Print application URLs, inbox URL, Studio command, and useful recovery commands without secrets or authentication tokens.

Running initialization twice preserves existing env values, application records, and uploads. A migration error or failed database check exits nonzero with actionable guidance. Never wipe a volume to repair an ordinary failure.

### Development contract

`pnpm dev` runs a finite **noncached** readiness preflight before Turbo launches persistent app/API/worker dev tasks. It verifies env completeness, a real DB query, and current schema readiness. If PostgreSQL is stopped, it may start the project's existing local container; failures stop the launch with a clear instruction. A configured remote/unrecognized URL is checked, never silently replaced or started as a local database.

Development startup does not silently generate new migrations or reset data. Use an explicit migration command when schema is behind. Check Mailpit/storage prerequisites for flows that need them. A worker that cannot initialize must report its failure rather than leave the UI claiming checks will run. Ctrl-C stops child development processes; persistent database containers remain available until explicitly stopped.

### Root command inventory

| Command | Intended behavior |
| --- | --- |
| `pnpm initialize` | Repeatable local environment setup, migrations, synthetic seed. |
| `pnpm dev` | DB/schema preflight, then all three frontends, API, and worker. |
| `pnpm db:start` / `pnpm db:stop` | Start/stop project DB without deleting data. |
| `pnpm db:status` | Show service state and real connectivity result. |
| `pnpm db:generate` / `pnpm db:migrate` | Generate reviewed migrations / apply committed migrations. |
| `pnpm db:seed` | Idempotent synthetic seed; no resets. |
| `pnpm db:studio` | Start local-only Drizzle Studio. |
| `pnpm infra:start` / `pnpm infra:stop` | Start/stop PostgreSQL and local mail services together. |
| `pnpm lint` / `pnpm format` | Biome checks / explicit formatting. |
| `pnpm typecheck` / `pnpm build` | Verify workspace types / production builds. |
| `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` | Unit, PostgreSQL/service, and browser suites. |
| `pnpm check` | Aggregate non-mutating lint, type, and unit checks. |

If a reset command is added, it is separately named, explicitly confirmed, limited to a known disposable local/test database, and never a dependency of the above commands. Tests must refuse to reset an unrecognized database.

`pnpm test:e2e` owns a disposable database and separate API/worker/frontend processes on free loopback ports. Sequential test shards restart only the owned API and expire only the generated database's identity rate windows between tests. The actual runtime rate limits stay enabled. The runner handles teardown on success, failure, and interruption; PostgreSQL/Mailpit and any developer app processes remain running. Private logs/reports are retained under ignored `.local/e2e-*` directories. Direct Playwright remains available for interactive development, but a large burst against a shared dev stack can exhaust its rate limits.

## Environment boundaries

Track `.env.example` templates with descriptions. Validate server env at process startup. Only explicit public URLs and public bank/product hints may enter frontend bundles. Database URL, session secrets, encryption keys, SMTP credentials, storage paths, and webhook verification material stay server-side. Configure environment injection centrally; do not rely on whatever directory a developer ran Turbo from.

Use project-specific container/volume names, localhost bindings, and configurable ports. Node/React/Fastify tooling runs on the host initially; Podman runs infrastructure. Keep build output, env files, private data, test reports containing tokens, and local generated files out of source control.

## Testing layers

| Layer | What to test |
| --- | --- |
| Unit | Money validation, lifecycle guards, requirement reconciliation, access policies, provider result validation, notification eligibility, fake-clock timing. |
| PostgreSQL integration | Real migrations, constraints, transaction rollback, concurrent idempotency, scoped queries, revision conflicts, outbox delivery, worker recovery. |
| HTTP integration | Session/token security, allowlisted DTOs, pagination, file validation, webhook verification, negative direct-ID access. |
| Component/browser | Critical form errors, keyboard controls, navigation, loading/error state, complete borrower/staff journeys. |
| Adapter contract | Same typed scenarios for every fake implementation, later reusable for real providers' sandbox adapters. |

Use Vitest for logic/service tests and Playwright for selected journeys. Use actual PostgreSQL in integration tests, with an isolated test database/schema strategy and unique fixtures per concurrent run. Stub only external providers. Exercise clean migrations and upgrade migrations as schemas evolve.

Do not add snapshot tests of generated shadcn markup or tests that merely restate static configuration. Use focused behavior checks, including failures. Run relevant checks during each task; expand only when changes or failures justify it.

## Required synthetic scenarios

- Bank A and isolated Bank B; officers in each; no cross-bank access.
- One borrower with two businesses, two active applications for one business, and a funded account.
- Unfinished setup at different saved questions, explicit optional skips, completed setup with remaining tasks, and a staff-prefilled draft still awaiting applicant confirmation. Include unfinished and completed setups for the same borrower.
- Requested amounts of $10,000, $5,000,000, and $7,500,000, plus an invalid/over-product-limit value.
- A business that initially lacks EIN and industry code; no SSN required during intake.
- One invited owner, one restricted lawyer, a pending invitation, and a revoked participant.
- Clean tax return, bank statement, unknown document, low-confidence document, blocked scan, and corrupt/unsupported file.
- Clear check, review flag, missing input, timeout, transient failure, terminal failure, and stale-result delivery.
- Multi-signer envelope, duplicate/out-of-order callback, signer decline, and expiry.
- Abandoned draft that gets a reminder and a resumed/submitted draft whose reminder is suppressed.

Use neutral fictional businesses and obviously synthetic identities. Fixtures should describe their intended result explicitly and never masquerade as real financial evidence.

## End-to-end acceptance journeys

1. Clean clone → initialize twice → start dev → open all apps and Studio; verify DB data survives a restart. With bad credentials/stopped unavailable DB, dev fails before launching apps.
2. Mock bank → email-first lead → authorized sign-in → one-question setup screens → Back/edit → close tab and clear browser storage → fresh sign-in → same saved application, answers, and current question → skip optional industry → finish setup → portal with remaining tasks. Exercise both local demo access and the Mailpit email-link path. Early portal deep links/direct API calls cannot bypass setup; failed saves/completion preserve recoverable input and do not unlock the portal. Staff sees progress throughout, including a staff-prefilled draft that still needs applicant confirmation. Subsequent sign-in goes to the completed application's portal.
3. Applicant with multiple applications selects the correct one; an unfinished setup opens its saved wizard step without blocking another completed application's portal. Another business's tasks/docs and setup state remain separate.
4. Applicant invites owner and lawyer; lawyer uploads to an assigned task; cannot access another application or private owner evidence. Revoke access while their session is active and verify denial.
5. Staff uploads documents; simulated scan/OCR categorize them; reviewer corrects one category and accepts evidence; original machine result remains in history.
6. Add required identifier → check starts → update input → old result arrives → old result is ignored. Worker restart and duplicate delivery do not duplicate current tasks/effects.
7. Submit → request more information → resubmit → approve → closing → all signers complete → record simulated funding → one funded account appears. Invalid transitions and duplicate funding are rejected/deduplicated.
8. An idle draft gets a local reminder under fake time; renewed activity, submission, or recipient removal suppresses stale queued notifications. Opening a previously delivered link resumes incomplete setup at its saved step, or opens the portal if setup has since finished.

## Verification records

Each task records what was checked, commands/results, and any skipped acceptance criterion. The final handoff includes fresh-setup evidence, example local inbox/fixture identities, and the supported demo path. Passing prototype checks does not imply production banking readiness.
