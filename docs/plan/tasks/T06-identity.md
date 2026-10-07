# T06 — Passwordless identity and sessions

Dependencies: T05. Read [identity rules](../03-domain-and-access.md#identity-and-invitations).

## Outcome

Borrowers and seeded staff can securely return through local email links without passwords.

## Scope

- Add pending contacts, verified identity binding, hashed email tokens, server-side sessions, expiration, and revocation storage.
- Add local Mailpit email adapter and queued access-link delivery. Queue a delivery-request ID; mint credentials in the worker and persist only hashes before SMTP. Follow shared consumption for retry-issued sibling tokens as specified in the identity rules.
- Support generic request-link responses and explicit confirm/consume routes. Generic resume never creates a new application; T07 connects pending-draft discovery after verification.
- Build request-link, check-inbox, confirmation, expired/used-link recovery, and logout screens. Preserve an allowlisted internal return destination.
- Use HttpOnly session cookies, origin/CSRF protection, send/login rate limits, and separate verified staff membership checks.
- Make link consumption a deliberate POST from a confirmation page, not a side effect of an email scanner's GET.

## Acceptance criteria

- A verified email link creates/resumes the appropriate identity/session; no password or raw token is stored in application/queue records or logs. The local inbox contains the delivered link by design.
- A pending contact or unverified email entry cannot read application data or become bank staff.
- Expired, replayed, tampered, or concurrently consumed tokens fail safely; a fresh requested link restores access.
- Logout/session revocation takes effect immediately. A borrower session cannot enter staff routes without membership.
- Return URLs cannot redirect to arbitrary sites; request-link responses do not enumerate known accounts.
- Local email delivery failures and crashes after SMTP acceptance recover without exposing tokens in logs. Retry-issued sibling links share one atomic consumption record; using one invalidates all siblings.

## Validation

Test token hashing, single-use races, expiry with fake time, session invalidation, CSRF/origin checks, enumeration/rate limits, and redirect validation. Run a browser journey through the Mailpit API/inbox using only synthetic addresses.

Application creation binds this identity flow to drafts in T07. Invitation acceptance is T11; recurring notifications are T18.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.

Deployment dependency: D02 introduces a native Workers HTTP transport alongside the local Fastify server. Connect the same trusted session resolver and CSRF policy to both, with negative authorization tests; hosted UI requests use same-origin `/api/*` service bindings.
