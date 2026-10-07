# D03 — Hosted demo authentication and delivery parity

Dependencies: D02, T06, T18. Read [the all-environment decision](../06-decisions-and-sources.md#all-environments-are-demos--october-7-2026).

## Outcome

The production URL runs the same synthetic demo journeys as local without real authentication or email services.

## Reported failure

On October 7, the user encountered `AUTH_DELIVERY_UNAVAILABLE` with the message “Email sign-in is available in the local demo. Hosted email delivery is not configured.” Request reference: `6364935f-f414-4ebe-8550-5ac9bcc1eb06`.

The affected hosted API disabled demo sign-in and email delivery. This was an implementation gap, not a requirement to set up real email. Earlier local-only assumptions are superseded by the user's explicit clarification; the gap is resolved by the implementation and hosted evidence below.

## Scope

- Enable the synthetic demo entry path on the deployed API, preserving bank scope, explicit staff memberships, sessions, CSRF and revocation checks.
- Provide repeatable, non-destructive hosted synthetic fixtures needed by the demo. Never seed real user or financial records.
- Provide simulated hosted delivery/inbox behavior for access links, application continuations, invitations, notifications and signature requests using T06/T18 contracts. No real SMTP, identity provider or external delivery is permitted.
- Keep simulation obvious in UI and delivery content. A simulated mailbox/identity confirmation is never a real identity determination.
- Route links to current setup/application/signature state with the same backend authorization and stale/replay behavior as local.

## Acceptance criteria

- Hosted borrower and staff demo sign-in work without `AUTH_DELIVERY_UNAVAILABLE` or a real inbox/provider.
- A synthetic borrower starts an application, resumes its saved setup step, enters its task portal, invites an intended participant and exercises simulated delivery/signing.
- Notifications and reminders are inspectable in the hosted demo without sending external email; retry and deduplication behavior matches local.
- Unknown or cross-bank identities do not acquire staff membership or access to another application's restricted resources. Demo convenience does not bypass these controls.
- Hosted health/readiness, migrations and native builds pass. Repeated fixture preparation preserves existing demo progress.
- T22 validates the full hosted demo alongside the local journeys. Record actual production-URL evidence before marking this task done.

## Implementation record

Done — October 7, 2026. Hosted API enables synthetic entry and uses a private database-backed demo inbox. An explicit “Open demo inbox” action signs in the chosen demo identity, and the existing one-time confirmation screen consumes its message. Every read rechecks current bank, recipient/contact and notification access. Message URLs are encrypted with purpose/bank/recipient/delivery/token binding; lists and unavailable messages never contain bearer links. Migration `0018_superb_sugar_man` adds one inbox table. No hosted SMTP or external identity service is used.

Native jobs dispatch inbox deliveries before scheduling bounded provider families. Queue consumers process one family per invocation; API wakes are best-effort after successful mutations and minute Cron recovers durable work. Local Mailpit remains the default; `DEMO_INBOX_ENABLED=true` exercises hosted-equivalent delivery locally. Both Workers require the same private encryption binding, installed without exposing its value.

The separate `infra/bootstrap-demo-access.sql` adds only the synthetic `officer-a@example.test` fixture to Synthetic Bank A. It refuses nonsynthetic collisions and never reactivates a revoked membership. It ran twice against the configured Neon demo with one active staff membership and no reset.

Local acceptance: private inbox 11 PostgreSQL tests, bootstrap 4 PostgreSQL tests, purpose-bound cipher 2 unit tests, both HTTP transport journeys, and native queue dispatch/idempotency checks pass. `DEMO_INBOX_ENABLED=true pnpm test:e2e tests/e2e/demo-inbox.spec.ts` passed 8/8 desktop/mobile cases, including deliberate confirmation, used links, sign-out/re-entry, saved setup resume, known staff and unknown-staff denial. No bearer traces or authentication screenshots were retained.


## Checkpoint validation

October 7, 2026: `pnpm check` passed Biome/browser boundaries, all 12 workspace typechecks plus root TypeScript, and 272 unit tests in 22 files. `pnpm test:integration` passed 326 PostgreSQL tests in 35 suites. `pnpm build` passed all 12 workspaces; borrower/console retain non-failing bundle-size warnings. Native API/jobs Wrangler dry runs passed. D03 inbox browser tests passed 8/8; review/navigation regression run passed 24/24 (6 review plus 18 workspace cases). Tests use disposable local databases and synthetic data; production acceptance is recorded separately.

## Hosted acceptance — October 7, 2026

Deployed checkpoint `b9c679d` passed all five native Cloudflare builds and [Neon migration run 37671862158](https://github.com/igoramidzic/keycade/actions/runs/37671862158). The repeatable synthetic staff bootstrap was applied twice without resetting existing progress. The browser checks used the actual [borrower portal](https://keycade-borrower.kualia.workers.dev) and [bank console](https://keycade-bank-console.kualia.workers.dev), with no real email or identity provider.

- Four hosted inbox cases passed: borrower deliberate confirmation and consumed-link concealment, fresh-link saved-setup resume, known synthetic staff confirmation, and unknown-staff denial. The report is `.local/hosted-d03-b9c679d/report.json`; its separate full-journey attempt stopped on a test navigation race, corrected before the successful run below. The strengthened staff consumed-detail check also passed in `.local/hosted-d03-b9c679d-staff-final/report.json`.
- The full hosted journey passed in 8.0 minutes: create a new synthetic application; save and resume the requested-amount setup step; finish setup and enter Tasks; upload a private synthetic PDF and wait for its clean scan; invite and accept an intended adviser with one assigned task; create a two-signer request; open each recipient's private inbox notification; deliberately confirm; complete both simulated signatures; download the immutable synthetic artifact; verify the signature task completed. Successful synthetic application ID: `5fda6825-4058-4b57-a6ad-a0edfa85220d`.
- The successful full-journey report is `.local/hosted-d03-b9c679d-full-final/report.json`. A targeted post-run consumed-message check confirmed the unavailable-link text, absent confirmation control, and absent bearer text; safe screenshot: `.local/hosted-d03-b9c679d-followup/hosted-consumed-message.png`. No authentication traces, videos, network dumps, or bearer screenshots were retained. The shared hosted database was preserved; test records remain visibly synthetic.
- A targeted authenticated download of the same application’s original R2 document matched the uploaded synthetic PDF bytes exactly. Its current interpretation was `classified` under `tax`. This demonstrates the deployed private upload, clean-scan, interpretation and authorized original-download path; the reusable journey now asserts original-byte equality as well as artifact download.

The reusable `playwright.hosted.config.ts` runs one desktop worker with request pacing and requires explicit HTTPS portal origins. It never starts local services or resets a database:

```sh
KEYCADE_E2E_HOSTED=true DEMO_INBOX_ENABLED=true \
KEYCADE_E2E_BORROWER_ORIGIN=https://keycade-borrower.kualia.workers.dev \
KEYCADE_E2E_STAFF_ORIGIN=https://keycade-bank-console.kualia.workers.dev \
pnpm exec playwright test --config=playwright.hosted.config.ts
```

The complete T22 hosted acceptance, including closing, recorded funding and operations diagnostics, remains separate work. Reminder delay/deduplication, revocation, cross-bank isolation and stale-result negative cases are covered by the PostgreSQL/transport suites; the hosted browser evidence above does not claim every failure scenario was repeated against the shared demo.
