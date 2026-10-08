# Keycade

Keycade is a synthetic bank-operated business lending demo, from initial application through human review, closing and one recorded funding event. It includes a mock bank website, a borrower portal and a bank staff console. **Every environment, including the public hosted URLs, is a simulation.** Use fictional people, businesses, documents and identifiers. Checks, document interpretation, signatures and funding make no real financial or identity determination; no money moves and no external email is sent.

The implementation includes resumable one-question setup, scoped collaborators and private tasks, private document uploads and interpretation, simulated checks, contextual notifications, review decisions, closing conditions, funded-account summaries, activity and operations diagnostics. [T22 integrated acceptance](docs/plan/tasks/T22-acceptance.md) is complete: all eight required journeys are covered, including clean initialization/restart, 140 core local browser cases and an actual hosted journey through recorded simulated funding. The [plan index](docs/plan/README.md) links feature validation and follow-up work.

[V2-01 expanded setup](docs/plan/v2/04-delivery-and-validation.md#v2-01--setup-contracts-migration-and-wizard) is complete locally: structured address, optional encrypted synthetic EIN/website, multiple funding purposes, preserved legacy applications and updated lender prefills. It has not been deployed to the hosted URLs.

[V2-02 borrower dashboard](docs/plan/v2/04-delivery-and-validation.md#v2-02--borrower-task-dashboard) is complete locally. It replaces the application tabs with tasks, saved-stage progress, sidebar uploads and contextual signing, review, closing, people and history links. Unsaved task answers survive these contextual visits; access loss clears the workspace. This change is local and has not been deployed.

[V2-03 demo text importer](docs/plan/v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures) is complete locally. Five registered text filenames generate synthetic tax/statement PDFs with period-labelled simulated fields, exact-byte validation and the normal protected scan/processing flow. Hosted deployment remains separate.

[V2-04 document workspace and reviewed financial facts](docs/plan/v2/04-delivery-and-validation.md#v2-04--document-workspace-and-reviewed-financial-facts) is complete locally. Staff can preview private PDFs/images and review source-bound financial suggestions and versioned document metadata, with immutable history and lifecycle/access guards. Validation passed 367 unit tests, 442 PostgreSQL tests, all 12 builds/typechecks and 46 distinct desktop/mobile browser cases. No v2 hosted deployment is claimed.

[V2-05 lender overview](docs/plan/v2/04-delivery-and-validation.md#v2-05--lender-overview-and-evidence-drilldowns) is complete locally: business/loan facts, reviewed revenue and adjusted-income history, grouped tax evidence, stage requirements/checks and recent activity. Queue filters and page survive navigation. Validation passed 373 unit tests, 449 PostgreSQL cases, all 12 builds/typechecks and 42 distinct desktop/mobile browser cases.

[V2-06 Loan Footprint](docs/plan/v2/04-delivery-and-validation.md#v2-06--simulated-loan-footprint) is complete locally. Open an application as a lender, then choose **Loan Footprint** in Overview or Checks. The dialog shows the saved address, asynchronous simulated US-country result and registered fixture map when available. Unknown map coordinates do not prevent a valid US result. Refresh is replay-safe; changed addresses invalidate old results and pins. It adds no readiness gate. V2-07 integrated local acceptance is complete; hosted parity remains V2-08.

[V2-07 integrated local acceptance](docs/plan/v2/04-delivery-and-validation.md#v2-07--integrated-local-acceptance) passed **410 unit tests, 479 PostgreSQL cases, all 12 builds/typechecks and 136 distinct desktop/mobile cases**. The connected journey covers setup/resume through imported evidence, deliberate financial review and Loan Footprint; separate regressions verify human review, signatures and funding. Session expiry now preserves ordinary unsaved setup answers for sign-in recovery while clearing unsaved EIN. V2-08 hosted parity is next.

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

Ready-to-use text stubs are in [the importer fixtures](packages/testing/fixtures/demo-imports). The kit's **Import demo text files** section also accepts UTF-8 `.txt` files up to 64 KiB each, at most ten at a time. Use `business-tax-return-2023.txt`, `business-tax-return-2024.txt`, `business-tax-return-2025.txt`, `business-bank-statement-2026-01.txt`, or `business-tax-return-review.txt`. The filename selects a fixed synthetic recipe; the text contents are ignored. Review the period, amounts and business snapshot, then Download, drag the generated PDF, or choose Upload. Uploads use the selected authorized business area and pass through scan and delayed simulation. The review return deliberately names a different fictional business and leaves adjusted income unknown. Ordinary upload areas still accept only PDF/JPEG/PNG; changing an arbitrary PDF's filename cannot select a recipe. See [V2-03 validation](docs/plan/v2/04-delivery-and-validation.md#v2-03--demo-text-importer-and-registered-fixtures).

1. Start at the mock bank and select **Apply for business financing**. Use a new `example.test` email. The default demo path opens setup immediately; the email-link option uses Mailpit or the private demo inbox. Setup asks one question at a time and always selects Synthetic Business Credit. Enter the legal business name and structured business address; optionally save a synthetic EIN, industry and website; then enter the requested amount and select one or more illustrated funding purposes. EIN entry accepts only the registered synthetic values listed below, shows a mask after save, and can be skipped. Website and industry can also be skipped. **Continue later** saves the current step. Sign in with the same email and resume the same application, then **Finish setup** to enter its portal.
2. Work from the borrower task dashboard to provide fictional answers or private synthetic identifiers. Expand **Application progress** to inspect saved stages. Use **People and access** to record owner relationships separately from portal access. In the lender console, open the application’s Participants view to invite a collaborator and select their Tasks to complete; confirm through that recipient's simulated message and accept the invitation to receive the selected assignments. Clients cannot create, resend or revoke invitations. A restricted adviser sees only assigned resources. Revocation applies immediately.
3. Upload a fixture from `packages/testing/fixtures/documents/` using **Upload other documents**, **View documents**, or the corresponding task’s document area. General sidebar uploads never satisfy a task automatically; private evidence stays in its private task. Wait for the simulated scan before downloading. Interpretation adds category and suggested fields; staff can correct a category with a reason while retaining original results and history. Replacing a document creates a new immutable version and reopens affected evidence.
4. As staff, inspect Checks and stage readiness. Required inputs and current evidence control the gates; a simulated result never approves an application automatically. The applicant uses **Review and submit application** when eligible, and staff explicitly begins review, requests information, declines or approves with immutable decision terms. Material edits require a return to information collection.
5. After approval, staff opens Closing and selects **Start closing**. Complete the generated funding-readiness task and attach a clean synthetic PDF to **Sign simulated closing agreement**. In Signatures, select that task, current document and intended verified signers. Send the request; each signer opens its message, confirms and explicitly acknowledges the simulation before signing. Every required signer must complete; the mandatory signature condition cannot be waived.
6. Staff records simulated funding after current closing gates pass. The demo product requires the exact approved USD amount, a date between approval and today in UTC, a reference and explicit human confirmation. One transaction records one funding event and one account. Borrower/staff account summaries show approved terms and the recorded event, marked **Simulated**. Approval alone creates no account. Assigned collaborators do not gain account or approved-terms access.
7. Use the borrower’s **View activity** link or the staff Activity tab for visible progress and the staff Operations view for processing state, attempts, current failures, worker health and backlog. Eligible retry/void controls recheck permissions and current inputs; they do not run arbitrary jobs.

Feature walkthroughs and negative-case evidence are linked from the [plan index](docs/plan/README.md). The [identity guide](docs/plan/identity-validation.md) documents local confirmation scenarios.

## Review document financial facts locally

Sign into the bank console as `officer-a@example.test` and open an editable synthetic application. In Documents, use the Scenario kit's **Import demo text files** input with `business-tax-return-2023.txt`, `business-tax-return-2024.txt` and `business-tax-return-2025.txt` from [the fixture folder](packages/testing/fixtures/demo-imports). Upload their generated PDFs and wait for clean scan and delayed interpretation. Open the private preview with page controls, zoom and Fit width; source-page links navigate to the corresponding PDF page.

Open a document workspace and inspect Analysis, Document Info and Versions for the selected file. In **Reviewed financial facts**, select a suggested field, choose Accept, Reject or Correct, inspect the current/proposed amount and provide a reason. Correct accepts an exact decimal such as `1250000.25`; metric, fiscal period, basis and USD unit stay tied to the source. Confirm replacement when changing an accepted amount. Reject preserves an earlier accepted value and adds review history. Missing values remain unavailable; ordinary income, explicitly adjusted income and bank deposits are separate fields.

Changing display name/description retains interpretation. Changing expected period, category, source version or analysis run marks accepted source references stale and requires a deliberate new review; it never substitutes new amounts automatically. Expected and extracted periods must agree before financial adoption. Submitted/decided applications must follow the existing return-for-information workflow before material edits. This review does not accept task evidence, approve the application or add a new readiness gate. Original authorized downloads remain available. In Overview, expand **Business tax returns** to see logical documents, separate version counts and current financial-review summaries. Select **Revenue** or **Adjusted net income** to inspect available periods in a chart and exact values table; each Source button opens its original version and analysis run. Missing or unconfirmed values are never filled with zero. Closing the file returns to the same expanded group/source, and **Back to applications** restores queue filters and page.

## Combined v2 walkthrough locally

Use one new fictional applicant throughout these steps, keeping borrower and staff in separate browser profiles. The local acceptance journey is `tests/e2e/v2-integrated.spec.ts`; the existing closing suite separately verifies human approval, two signers and one replay-safe simulated funding event.

1. Start from the mock bank with a new `example.test` email and a fictional legal business name. To see the registered map, use **123 Synthetic Avenue, Portland, ME 04101, US**. Skip optional EIN/industry/website or supply the documented synthetic values. Select **Working Capital** and **Equipment Purchase** using the keyboard. Choose **Continue later**, clear browser storage, and sign in again with the same email. Confirm the saved answers and finish setup.
2. On the task dashboard, expand **Application progress** and open **Scenario kit**. In **Import demo text files**, select the three `business-tax-return-2023.txt` through `business-tax-return-2025.txt` stubs and `business-bank-statement-2026-01.txt`. Upload each generated PDF into the application's permitted business documents. Wait for clean scan and simulated interpretation; these general uploads leave task requirements outstanding.
3. In the bank console as `officer-a@example.test`, find the same application and open Overview. Expand **Business tax returns**; it should contain three logical documents. Open each document, inspect its rendered PDF and source period, then deliberately accept the **Revenue / net sales** and **Adjusted net income** suggestions with a review reason.
4. Back in Overview, inspect Revenue and Adjusted net income history and source links. The registered recipes supply annual revenue of **$1,200,000 / $1,350,000 / $1,500,000** and adjusted income of **$180,000 / $210,000 / $240,000** for 2023–2025. The January statement's **$125,000 deposits** remain a separate metric. Only deliberately reviewed values appear as confirmed financial facts.
5. Open **Loan Footprint** and check the saved address, synthetic map and **Within the demo's US footprint** result. Close with Escape and return to the triggering control. Continue the human review, signatures and closing steps above after satisfying their existing requirements. Reviewing financial suggestions and a clear footprint do not approve or fund the application.

Run the connected journey with `pnpm test:e2e tests/e2e/v2-integrated.spec.ts`; run the review/funding regressions with `pnpm test:e2e tests/e2e/review.spec.ts tests/e2e/closing.spec.ts`. These local checks use isolated databases and synthetic records. [V2-07](docs/plan/v2/04-delivery-and-validation.md#v2-07--integrated-local-acceptance) records the tested revision and complete results; hosted parity remains V2-08.

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
- After shared-contract changes, a running Vite frontend may retain cached exports. Restart the affected frontend watcher and reload if it reports an export that the source already contains; the V2-04 local borrower-port recovery required only that restart.
- Port conflicts and unrecognized database targets fail without stopping their owners. Change the configured unused ports before initialization; do not kill unrelated services.

This is not production banking software. Live registry/tax/KYC providers, real malware scanning and OCR, legally effective signatures, real email/authentication, SSO and production banking controls are future work. The current release ends at one recorded simulated funding event: no repayment schedules, balances, payment collection, interest, further draws or servicing accounting. Extracted values are suggestions, staff make explicit decisions, and a funded-account summary is not an outstanding balance.
