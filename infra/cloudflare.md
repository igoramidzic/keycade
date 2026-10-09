# Cloudflare demo deployment

Account: `7ca70a1deedbffff10d49a5e395aa978`. Repository: `igoramidzic/keycade`, production branch `main`, root directory `/` for all five builds. Watch paths include `*` so shared package changes redeploy every dependent app. Cloudflare installs the root pnpm lockfile, including pinned Wrangler 4.148.0; keep development dependencies installed.

| Worker | Build command | Deploy command |
| --- | --- | --- |
| `keycade-bank-site` | `pnpm --filter @keycade/bank-site build` | `pnpm exec wrangler deploy --config apps/bank-site/wrangler.jsonc` |
| `keycade-borrower` | `pnpm --filter @keycade/borrower build` | `pnpm exec wrangler deploy --config apps/borrower/wrangler.jsonc` |
| `keycade-bank-console` | `pnpm --filter @keycade/bank-console build` | `pnpm exec wrangler deploy --config apps/bank-console/wrangler.jsonc` |
| `keycade-api` | Leave blank | `pnpm exec wrangler deploy --config apps/api/wrangler.jsonc` |
| `keycade-jobs` | Leave blank | `pnpm exec wrangler deploy --config apps/worker/wrangler.jsonc` |

Cloudflare's `WORKERS_CI=1` selects hosted navigation URLs during Vite builds. Local builds can use `KEYCADE_DEPLOYMENT=cloudflare` explicitly; normal `pnpm dev` retains local URLs. No database or integration secret is exposed through Vite.

| Surface | URL |
| --- | --- |
| Mock bank | https://keycade-bank-site.kualia.workers.dev |
| Borrower | https://keycade-borrower.kualia.workers.dev |
| Bank console | https://keycade-bank-console.kualia.workers.dev |
| API diagnostics | https://keycade-api.kualia.workers.dev/api/health and `/api/ready` |
| Jobs | Private service binding; public URL disabled |

The UIs serve assets and forward `/api/*` through the `API` binding. API uses `JOBS` to check the jobs Worker. Neither browser code nor public requests supply database credentials or authentication identities. API rate limiting uses a platform binding; mutation origins are restricted to the three hosted UIs. Sessions arrive in T06.

API and jobs bind `HYPERDRIVE` to `keycade-db`, ID `2aa8c3bf77af4beb8208f07007fada92`. It connects to the existing Neon production database over TLS with the dedicated `keycade_runtime` login. Query caching is disabled; the database origin connection limit is five. The Cloudflare configuration owns the password; Wrangler configuration contains only the resource ID.

Queue `keycade-jobs`, ID `552b7d8c745e420f8fadbb088a670e07`, delivers operation IDs to the jobs Worker. Its minute Cron recovers expired leases and sends pending durable outbox work. Simulation delay defaults to two seconds. Application retries remain database state; terminal/waiting/stale results are preserved. There is no hosted polling process or pg-boss schema initialization.

GitHub's `neon-production` environment owns migrations and the optional runtime-login setup. The one-time setup succeeded in [run 37560937054](https://github.com/igoramidzic/keycade/actions/runs/37560937054); `NEON_RUNTIME_SETUP_ENABLED` is now `false`. To intentionally rotate the runtime password, update its encrypted GitHub secret, enable that flag, run the workflow, update Hyperdrive's origin password securely, verify readiness, then disable the flag. Never store credentials in source or build commands.

Application builds and GitHub migrations run independently. Use additive schema changes, wait for the GitHub migration run, and check `/api/ready` before testing a release. Missing required schema produces a 503; Workers do not apply migrations themselves. Separate CI regression checks remain paused for this demo at the user's request.

The initial hosted foundation shipped without seeded records. On October 7, the deployed intake route returned 404 because Neon still had zero banks and products, while local initialization supplied both. The explicit [demo intake bootstrap](bootstrap-demo-intake.sql) now provisions only Synthetic Bank A (`bank-a`) and its Synthetic Business Credit product. It runs transactionally, preserves existing rows, rejects a non-synthetic bank, and is safe to repeat. It is separate from automatic migrations and the full local fixture seed; it creates no users, memberships, or applications. Execute it only against the intended hosted demo database through a TLS-verified PostgreSQL connection, keeping credentials private.

Hosted verification after bootstrap: borrower `/api/v1/public/banks/bank-a/intake` returned 200 with the synthetic product, unknown-bank intake remained 404, and `/api/ready` returned 200. This verifies catalog availability, not the complete hosted sign-in/upload/enrichment journey.

For local deployment checks, build the UIs with `KEYCADE_DEPLOYMENT=cloudflare`, then run each deploy command with `--dry-run`. Generate binding types after configuration changes using `wrangler types --include-runtime false --env-interface ApiBindings` (or `JobsBindings`) with the matching config and output path. Local Hyperdrive emulation accepts `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; supply the recognized local database URL privately through the environment.


## Synthetic hosted access and work dispatch

Every hosted URL is a demo. API/jobs share a private `ENCRYPTION_KEY` secret (64 lowercase hex characters), declared required in both Wrangler configs. It encrypts synthetic identifiers and purpose-bound inbox links; do not rotate it without a data migration. `DEMO_INBOX_ENABLED=true` uses private database delivery, never SMTP. The explicit non-destructive `bootstrap-demo-intake.sql` and `bootstrap-demo-access.sql` scripts prepare only Synthetic Bank A, its product and `officer-a@example.test`; ordinary deployments run migrations without reseeding.

Successful API mutations wake the private jobs service through `waitUntil`. The service enqueues durable dispatch; minute Cron recovers missing wakes. Inbox delivery is dispatched ahead of bounded provider-family queue messages, and consumers use batch size one. Signing, checks, extraction and enrichment remain simulated; product wording follows the neutral presentation direction in D07. Session/origin/CSRF and bank/participant restrictions apply equally on hosted URLs.
