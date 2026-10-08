# Keycade

Keycade is a synthetic bank-operated business lending demo, from initial application through human review, closing and one recorded funding event. It includes a mock bank website, a borrower portal and a bank staff console. **Every environment, including the public hosted URLs, is a simulation.** Use fictional people, businesses, documents and identifiers. Checks, document interpretation, signatures and funding make no real financial or identity determination; no money moves and no external email is sent.

The implementation includes resumable one-question setup, scoped collaborators and private tasks, private document uploads and interpretation, simulated checks, contextual notifications, review decisions, closing conditions, funded-account summaries, activity and operations diagnostics. [T22 integrated acceptance](docs/plan/tasks/T22-acceptance.md) is complete: all eight required journeys are covered, including clean initialization/restart, 140 core local browser cases and an actual hosted journey through recorded simulated funding. The [plan index](docs/plan/README.md) links feature validation and follow-up work.

[V2-01 expanded setup](docs/plan/v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) is complete locally: structured address, optional encrypted synthetic EIN/website, multiple funding purposes, preserved legacy applications and updated lender prefills. It has not been deployed to the hosted URLs.

[V2-02 borrower dashboard](docs/plan/v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) is complete locally. It replaces the application tabs with tasks, saved-stage progress, sidebar uploads and contextual signing, review, closing, people and history links. Unsaved task answers survive these contextual visits; access loss clears the workspace. This change is local and has not been deployed.

## Start locally

Use Node **24.21.0 LTS**, pnpm **10.34.6**, and Podman. With nvm, run `nvm install && nvm use`; workspace dependencies also include the pinned Node runtime. On macOS, create a Podman machine once with `podman machine init` if none exists. Initialization starts the configured machine. No Compose provider is required. Unset `CONTAINER_HOST` and `CONTAINER_CONNECTION`; the local scripts refuse remote Podman overrides.

```sh
pnpm install
pnpm initialize
pnpm dev
```

Initialization creates a private ignored `.env`, generates missing local secrets, starts project-owned PostgreSQL 18.6 and Mailpit on loopback ports, verifies database credentials, applies committed Drizzle migrations, initializes pg-boss and inserts missing synthetic fixtures. Repeating it preserves existing values, records and volumes. Change container names or ports in `.env` before first initialization if defaults conflict; an existing container must match its configured identity, image, storage and bindings.

`pnpm dev` checks the actual database connection, migration history, queue schema and available ports before launching the three frontends, Fastify API and Node/pg-boss worker. API readiness also requires a healthy worker heartbeat. Browser bundles receive only allowlisted public URLs and mode flags, never database credentials or encryption keys.

| Surface | Local URL or command |
| --- | --- |
| Mock bank | http://127.0.0.1:3000 |
| Borrower portal | http://127.0.0.1:3001 |
| Bank console | http://127.0.0.1:3002 |
| API health / readiness | http://127.0.0.1:4000/api/health · http://127.0.0.1:4000/api/ready |
| OpenAPI | http://127.0.0.1:4000/api/openapi.json |
| Local Mailpit inbox | http://127.0.0.1:8025 |
| Drizzle Studio | `pnpm db:studio`, then https://local.drizzle.studio; listener is 127.0.0.1:4983 |

Ctrl-C stops app processes. PostgreSQL and Mailpit remain available. `pnpm infra:stop` stops only the project containers and preserves storage; `pnpm infra:start` restarts them.

## Access and simulated delivery

**Sign in to demo** opens a session for a synthetic identity without requiring an actual mailbox. New borrower emails do not inherit another application's access, and unknown staff emails never receive bank membership. Bank and application permissions, restricted task/document scopes, revocations, origin checks and CSRF remain enforced in the backend. Borrower and staff sessions are isolated by portal origin, including local ports.

**Use an email link instead** exercises the one-time confirmation flow. Locally, delivery goes to Mailpit by default. Open the message, follow its link and deliberately select **Confirm and sign in**. Invitation acceptance is a separate action after confirmation; signing also requires the intended recipient's confirmed session.

To use the private in-app inbox locally, restart development with:

```sh
DEMO_INBOX_ENABLED=true pnpm dev
```

The hosted demo already uses this mode. After requesting a link, choose **Open demo inbox**, select the message, then **Open confirmation** and **Confirm and sign in**. This verifies only the simulated identity flow. Messages are restricted to the current demo identity and bank. Used, expired or no-longer-authorized messages expose no usable link. Nothing is delivered to a real email address. Reminder settings apply to the signed-in user's own preferences; defaults are one and three days of inactivity.

## Walk through the demo

The borrower portal and bank console include a pale indigo **Scenario kit** fixed on the right of wide screens. On smaller screens choose **Show demo kit**. Select **Everything checks out**, **Needs a closer look**, or **Failures and recovery** for fictional business/client/guarantor details, twelve generated sample PDFs, and guided steps through the app. Use the borrower’s **Upload other documents** area, open **View documents**, or expand an uploadable task, then drag a PDF into its drop area or choose the sample's **Upload** button. **Download** saves the same PDF. Guarantor evidence uses its private task area. Matching samples use the open application's saved business name; the review kit includes a deliberate mismatch and cash-flow issue. All findings are simulated suggestions; no OpenAI key is needed. See [D05 validation](docs/plan/tasks/D05-demo-scenarios.md).

1. Start at the mock bank and select **Apply for business financing**. Use a new `example.test` email. The default demo path opens setup immediately; the email-link option uses Mailpit or the private demo inbox. Setup asks one question at a time and always selects Synthetic Business Credit. Enter the legal business name and structured business address; optionally save a synthetic EIN, industry and website; then enter the requested amount and select one or more illustrated funding purposes. EIN entry accepts only the registered synthetic values listed below, shows a mask after save, and can be skipped. Website and industry can also be skipped. **Continue later** saves the current step. Sign in with the same email and resume the same application, then **Finish setup** to enter its portal.
2. Work from the borrower task dashboard to provide fictional answers or private synthetic identifiers. Expand **Application progress** to inspect saved stages. Use **People and access** to record owner relationships separately from portal access. In the lender console, open the application’s Participants view to invite a collaborator and select their Tasks to complete; confirm through that recipient's simulated message and accept the invitation to receive the selected assignments. Clients cannot create, resend or revoke invitations. A restricted adviser sees only assigned resources. Revocation applies immediately.
3. Upload a fixture from `packages/testing/fixtures/documents/` using **Upload other documents**, **View documents**, or the corresponding task’s document area. General sidebar uploads never satisfy a task automatically; private evidence stays in its private task. Wait for the simulated scan before downloading. Interpretation adds category and suggested fields; staff can correct a category with a reason while retaining original results and history. Replacing a document creates a new immutable version and reopens affected evidence.
4. As staff, inspect Checks and stage readiness. Required inputs and current evidence control the gates; a simulated result never approves an application automatically. The applicant uses **Review and submit application** when eligible, and staff explicitly begins review, requests information, declines or approves with immutable decision terms. Material edits require a return to information collection.
5. After approval, staff opens Closing and selects **Start closing**. Complete the generated funding-readiness task and attach a clean synthetic PDF to **Sign simulated closing agreement**. In Signatures, select that task, current document and intended verified signers. Send the request; each signer opens its message, confirms and explicitly acknowledges the simulation before signing. Every required signer must complete; the mandatory signature condition cannot be waived.
6. Staff records simulated funding after current closing gates pass. The demo product requires the exact approved USD amount, a date between approval and today in UTC, a reference and explicit human confirmation. One transaction records one funding event and one account. Borrower/staff account summaries show approved terms and the recorded event, marked **Simulated**. Approval alone creates no account. Assigned collaborators do not gain account or approved-terms access.
7. Use the borrower’s **View activity** link or the staff Activity tab for visible progress and the staff Operations view for processing state, attempts, current failures, worker health and backlog. Eligible retry/void controls recheck permissions and current inputs; they do not run arbitrary jobs.

Feature walkthroughs and negative-case evidence are linked from the [plan index](docs/plan/README.md). The [identity guide](docs/plan/identity-validation.md) documents local confirmation scenarios.

## Fixtures and controls

Local `pnpm initialize` / `pnpm db:seed` inserts stable fixtures from `packages/db/src/seed.ts`, preserving existing rows:

| Identity | Local scope |
| --- | --- |
| `borrower@example.test` | Bank A: Cedar and Maple applications, two completed setups, a draft awaiting its v2 business address and a withdrawn draft |
| `officer-a@example.test` | Bank A synthetic administrator |
| `officer-b@example.test` | Bank B officer; use `?bank=bank-b` on the local portal |
| `adviser@example.test` | Restricted assigned participation in the small Bank A application; no implied task grants |
| `revoked-owner@example.test` | Revoked participation; sign-in does not restore access |

The seed also includes an owner relationship with no portal account and an unshared application for an existing business. Amount fixtures cover $10,000, $5,000,000 and $7,500,000. No real identifiers, documents or funded accounts are seeded. Hosted preparation is smaller: Synthetic Bank A, its Business Credit product and `officer-a@example.test`; other demo borrowers and applications are created through the UI.

Document fixtures use registered content hashes, so renaming a file does not change its outcome:

| Files in `packages/testing/fixtures/documents/` | Demonstration |
| --- | --- |
| `clean-tax.pdf`, `clean-statement.pdf` | Clean scan and simulated tax/bank-statement interpretation |
| `unknown.pdf`, `low-confidence.pdf` | Unclassified or review-needed interpretation |
| `blocked.pdf`, `scan-error.pdf`, `scan-transient.pdf` | Quarantine, scan failure and retry |
| `processing-error.pdf`, `processing-timeout.pdf`, `processing-transient.pdf` | Interpretation failure, timeout and retry |

Uploads support PDF, JPEG and PNG. Local defaults are 25 MiB per file and ten files per batch, controlled by `DOCUMENT_MAX_FILE_BYTES` and `DOCUMENT_MAX_BATCH_FILES`. Bytes stay in ignored private local storage (`PRIVATE_STORAGE_PATH`, default `.local/uploads`) or the private hosted R2 bucket. There are no permanent public download URLs.

Secure EIN/SSN tasks accept only registered invalid-for-real-world synthetic values `000000001` through `000000007`: success, no match, review, transient error, timeout, terminal error and missing input respectively. Never enter a real identifier. Tax simulation additionally requires its explicit authorization. The staff signature form has a clearly labeled simulated delivery scenario for success, retryable failure or failed delivery.

With `pnpm dev` running, a second terminal can exercise the harmless durable-job fixture:

```sh
pnpm jobs:demo success
pnpm jobs:demo transient_error
pnpm jobs:demo missing_input
pnpm jobs:demo timeout
pnpm jobs:demo terminal_error
```

These commands target a known local synthetic application and print persisted transitions. Adjust `SIMULATION_DELAY_MS`, `PROVIDER_DEADLINE_MS` and `JOB_MAX_ATTEMPTS` in `.env`, then restart development to change delays/retries. `REMINDER_FIRST_DELAY_MS` and `REMINDER_SECOND_DELAY_MS` control inactivity reminders; the second must be later than the first. Providers are asynchronous simulations with durable intent, bounded retries and stale-input checks.

## Commands and verification

| Command | Behavior |
| --- | --- |
| `pnpm check` | Biome, browser/server boundary check, strict TypeScript and unit tests |
| `pnpm build` | Production Vite builds and server/shared-package compilation checks |
| `pnpm test:integration` | Real PostgreSQL suites with disposable databases, including migrations, isolation, rollback, duplicates and worker recovery |
| `pnpm test:e2e` | Isolated local desktop/mobile browser journeys; hosted-only and optional inbox tests skip by default |
| `DEMO_INBOX_ENABLED=true pnpm test:e2e tests/e2e/demo-inbox.spec.ts` | Local private-inbox parity acceptance |
| `pnpm format` | Apply Biome formatting and safe fixes |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes for review |
| `pnpm db:migrate` / `pnpm db:seed` | Apply committed migrations / insert missing synthetic fixtures on the recognized local target |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | Persistent project database lifecycle and authenticated status |
| `pnpm infra:start` / `pnpm infra:stop` | Database and Mailpit lifecycle |
| `pnpm db:migrate:neon` | GitHub Actions only: apply pending migrations to the explicitly configured Neon target |

Install Chromium once if needed with `pnpm exec playwright install chromium`. The local browser runner requires initialized PostgreSQL and Mailpit, creates a disposable database and private upload directory, starts owned app processes on free loopback ports, and runs sequential shards with real rate limits enabled. It removes its database and stops only its own processes. Reports remain in ignored `.local/e2e-*` directories. Filter with `pnpm test:e2e tests/e2e/closing.spec.ts --project=desktop` or `pnpm test:e2e --grep 'saved setup'`. Use `pnpm exec playwright test` for interactive runs against an existing local stack.

Integration tests do not reset the development database. The maintainer probe `pnpm exec tsx scripts/verify-local.ts` verifies repeated initialization and database stop/start persistence; stop dev and Studio first because that probe intentionally stops the project database briefly. T22 records the separate disposable-copy initialization/restart checks and the combined acceptance evidence.

## Hosted demo and deployment

| Surface | Hosted URL |
| --- | --- |
| Mock bank | https://keycade-bank-site.kualia.workers.dev |
| Borrower portal | https://keycade-borrower.kualia.workers.dev |
| Bank console | https://keycade-bank-console.kualia.workers.dev |
| API readiness | https://keycade-api.kualia.workers.dev/api/ready |

Use a new fictional `example.test` borrower or the provisioned synthetic staff identity `officer-a@example.test`. Hosted sign-in and message confirmation use **Demo inbox**, never a real mailbox. The hosted database is shared demo state; preserve existing records and use unique synthetic identities when testing.

Five Workers build from `main` using Cloudflare's native GitHub integration. The UIs forward `/api/*` through a private API service binding. API/jobs use Neon PostgreSQL through Hyperdrive, private R2 documents, Queues and minute Cron recovery. Fastify/pg-boss remain the local adapters for the same domain rules and transactional job intent. The jobs Worker has no public endpoint. See [Cloudflare configuration](infra/cloudflare.md) and [Neon operations](infra/neon.md).

GitHub Actions applies committed additive migrations; Workers never migrate or seed. The explicit `infra/bootstrap-demo-intake.sql` and `infra/bootstrap-demo-access.sql` scripts prepare the minimal synthetic hosted catalog/staff and refuse incompatible nonsynthetic collisions. API/jobs share a private `ENCRYPTION_KEY` binding for encrypted identifiers and inbox messages. Preserve the key; changing it without a data migration makes existing encrypted data unreadable. Do not put it or database credentials in source, logs, browser settings or command history.

**Automatic CI validation and the PR validation trigger remain paused at the user's request.** The migration workflow and native app builds still run independently. Local checks remain required; wait for migrations, all dependent builds and readiness before testing schema-dependent releases. The current hosted release and evidence are recorded in the plan, not inferred from the working tree.

Run the explicitly opted-in hosted acceptance suite without starting local services:

```sh
KEYCADE_E2E_HOSTED=true DEMO_INBOX_ENABLED=true \
KEYCADE_E2E_BORROWER_ORIGIN=https://keycade-borrower.kualia.workers.dev \
KEYCADE_E2E_STAFF_ORIGIN=https://keycade-bank-console.kualia.workers.dev \
pnpm exec playwright test --config=playwright.hosted.config.ts
```

This uses one desktop worker, paced API requests and new synthetic identities. It preserves shared data and disables authentication traces, videos and automatic screenshots. The hosted API allows 120 requests per minute; avoid concurrent acceptance runs. [T22's hosted record](docs/plan/tasks/T22-acceptance.md#hosted-funding-and-final-handoff) verifies exact simulated funding, duplicate protection, scoped accounts, activity and operations against the deployed demo.

## Troubleshooting and boundaries

- If startup cannot authenticate to PostgreSQL, run `pnpm db:status` and `pnpm infra:start`. Preserve `.env` and the volume; do not reset data to fix mismatched credentials or container configuration.
- If schema readiness fails, run `pnpm db:migrate` locally. On hosted deployments, inspect the independent GitHub migration result before testing the new build.
- If health succeeds but readiness fails, check worker startup/heartbeat and the private runtime logs. Background work persists while a worker is unavailable and resumes with current-input guards.
- If a local link has no message, verify Mailpit is running or enable `DEMO_INBOX_ENABLED=true` and restart both API and worker. Use the same portal origin throughout. Request a new message for an expired or consumed link.
- If hosted demo access fails, check readiness, matching API/jobs inbox configuration, the required shared key and synthetic staff bootstrap. Unknown staff denial is expected; installing a real auth/email service is not the remedy.
- Port conflicts and unrecognized database targets fail without stopping their owners. Change the configured unused ports before initialization; do not kill unrelated services.

This is not production banking software. Live registry/tax/KYC providers, real malware scanning and OCR, legally effective signatures, real email/authentication, SSO and production banking controls are future work. The current release ends at one recorded simulated funding event: no repayment schedules, balances, payment collection, interest, further draws or servicing accounting. Extracted values are suggestions, staff make explicit decisions, and a funded-account summary is not an outstanding balance.
