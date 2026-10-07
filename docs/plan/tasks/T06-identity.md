# T06 — Passwordless identity and sessions

Dependencies: T05, D02. Read [identity rules](../03-domain-and-access.md#identity-and-invitations).

## Outcome

Borrowers and seeded staff can return without passwords. By the user's explicit demo override, local development defaults to entering an email and signing in immediately; local email links remain an optional verification/test flow.

## Scope

- Add pending contacts, verified identity binding, hashed email tokens, server-side sessions, expiration, and revocation storage.
- Add local Mailpit email adapter and queued access-link delivery. Queue a delivery-request ID; mint credentials in the worker and persist only hashes before SMTP. Follow shared consumption for retry-issued sibling tokens as specified in the identity rules.
- Support generic request-link responses and explicit confirm/consume routes. Generic resume never creates a new application; T07 connects pending-draft discovery after verification.
- Build request-link, check-inbox, confirmation, expired/used-link recovery, and logout screens. Preserve an allowlisted internal return destination.
- Use HttpOnly session cookies, origin/CSRF protection, send/login rate limits, and separate verified staff membership checks.
- Make link consumption a deliberate POST from a confirmation page, not a side effect of an email scanner's GET.
- Support explicitly enabled local demo sign-in with a recorded authentication method, synthetic-only identities/banks, and existing backend grants. It does not assert mailbox ownership or mark an email verified.

## Acceptance criteria

- A verified email link creates/resumes the appropriate identity/session; no password or raw token is stored in application/queue records or logs. The local inbox contains the delivered link by design.
- A pending contact or unverified email entry cannot read application data or become bank staff.
- Expired, replayed, tampered, or concurrently consumed tokens fail safely; a fresh requested link restores access.
- Logout/session revocation takes effect immediately. A borrower session cannot enter staff routes without membership.
- Return URLs cannot redirect to arbitrary sites; request-link responses do not enumerate known accounts.
- Local email delivery failures and crashes after SMTP acceptance recover without exposing tokens in logs. Retry-issued sibling links share one atomic consumption record; using one invalidates all siblings.
- Demo sign-in enters directly from email without queueing mail. Staff membership, bank boundaries, origin/CSRF, expiry and revocation still apply. Disabling demo sign-in also rejects existing demo sessions. The UI labels demo access clearly.

## Validation

Test token hashing, single-use races, expiry with fake time, session invalidation, CSRF/origin checks, enumeration/rate limits, and redirect validation. Run a browser journey through the Mailpit API/inbox using only synthetic addresses.

Application creation binds this identity flow to drafts in T07. Invitation acceptance is T11; recurring notifications are T18.

## Implementation record

Done — October 6, 2026. Local test handoff: [identity and demo sign-in guide](../identity-validation.md).

Implemented pending-contact binding, hashed expiring credentials, shared sibling-token consumption, revocable origin-bound sessions, explicit staff checks, database-backed send/consume limits, transactional identity audit, and an ID-only pg-boss delivery queue with a local Mailpit SMTP adapter. Confirmation is a deliberate POST; raw link credentials stay in memory and the intended local email. The token fragment is removed on page load. Both Fastify and the native Worker use the trusted resolver and origin/CSRF policy. Local session reads have their own 240/minute budget; send/login budgets remain separate and stricter.

The user's later instruction adds immediate local demo sign-in as the default. It accepts an email without sending mail, uses a recorded demo authentication method, does not mark the email verified, and only authenticates synthetic users/banks. Demo actors remain limited to the selected bank and existing grants/memberships. Disabling demo mode rejects existing demo sessions. The optional email-link journey remains available.

Additive Drizzle migrations: `0002_ordinary_boomerang.sql` and `0003_flashy_wonder_man.sql`. Fresh test databases and the existing local database were migrated successfully; repeated `pnpm initialize` preserved records and completed as a no-op for applied migrations. shadcn Input was generated with `npx shadcn@latest add input --yes`; pnpm remains the sole repository package manager/lockfile.

Validation:

- `pnpm check`: Biome, browser/server boundaries, all workspace/root types, and **118 unit tests passed**.
- `pnpm build`: all **12 workspace build tasks passed**.
- `pnpm test:integration`: **79 tests passed** against isolated real PostgreSQL databases, including auth races/expiry, retry siblings, queue/SMTP crash recovery, transactional rollback, origin/CSRF checks, demo synthetic-only scope, staff and session revocation, and disabled-demo rejection in both transports.
- `pnpm test:e2e`: **19 passed, 1 intentionally skipped**. Desktop/mobile verify immediate demo sign-in, no email request, persistence/logout, staff membership, optional borrower email confirmation/replay/fresh-link recovery, a failed session response immediately after confirmation, and network-failure input preservation. The seeded staff email-link journey runs once on desktop to avoid two projects consuming the same inbox link; direct staff demo sign-in is tested on both viewports.
- API Worker bundle dry run passed; no hosted deployment, email provider, or hosted seeds were created. Hosted sign-in remains explicitly unavailable pending its configured demo delivery/fixture slice.

Local Podman and `pnpm dev` are left running for user testing. During validation the Podman VM stopped after short setup sessions; keeping `pnpm initialize && pnpm dev` in one live session held the VM/database up and the complete suites then passed. Playwright now requests graceful shutdown for its own dev server so the detached Turbo group can exit.

Stopping point: authenticated/demo access screens only. Draft creation, setup wizard progress, and application workspaces remain T07–T10. The demo override is propagated into T07/T08 acceptance criteria and the requirement map.

Deployment dependency: D02 introduces a native Workers HTTP transport alongside the local Fastify server. Connect the same trusted session resolver and CSRF policy to both, with negative authorization tests; hosted UI requests use same-origin `/api/*` service bindings.
