# T11 — Participants, beneficial owners, and invitations

Dependencies: T09, T10. Read [domain/access rules](../03-domain-and-access.md).

## Outcome

Applicants and staff can safely bring owners and advisers into the relevant application.

## Scope

- Add business relationship records, scoped invitations, acceptance, expiry, resend, revoke, and participant management views on both dashboards.
- Use T06 email delivery/session primitives; invitation acceptance verifies the invited email and applies only the specified grant.
- Define participant roles and explicit application/task/document scopes, including private owner information. Implement policy primitives now; enforce them on task/document resources when those tables arrive.
- Allow applicant administrators to invite application roles only. Staff membership management remains separate.
- Handle participant removal by denying future access and marking their unfinished work unassigned without deleting authorship/history.

## Acceptance criteria

- An owner relationship can exist without a user account or portal grant.
- A lawyer invite defaults to restricted scope and does not grant another application or general business-wide access.
- Pending/expired/revoked invitations grant no access. Acceptance by a different email is rejected.
- A borrower cannot grant officer/admin roles or widen scope beyond their own delegation authority. Acceptance rechecks current authority; an inactive/revoked inviter's obsolete grant cannot be accepted.
- Removing a participant invalidates future reads/writes through their existing session immediately.
- Invite/revoke/resend operations are audited and idempotent; concurrent acceptance creates one membership.

## Validation

Test a complete role/scope matrix, duplicate/replayed acceptance, expiration, same-email existing identity, wrong recipient, privilege escalation, and active-session revocation. Run borrower-invites-lawyer and staff-adds-owner browser journeys through the local inbox.

Do not expose another person's identifiers to an applicant administrator merely because they own the application.

## Implementation record

Done — implemented and validated October 7, 2026.

Borrower **People** and bank **Participants** now share a management view for owner relationships, application grants, invitations, resend/revoke, and removal. Adviser and owner invitations default to assigned scope; application administrators receive full application scope. A recorded owner is a separate business relationship, with optional ownership percentage and no automatic account or portal grant. The seed includes a synthetic owner without a user account.

Migration `0007_volatile_mordo.sql` adds bank/application-scoped relationships, invitations, idempotent command records, explicit task/document grant lists, participant unassignment markers, and invitation-linked access delivery requests. Invitations persist their inviter's grant identity/version and recheck current delegation authority at acceptance. Removal clears current grants, records unassignment, revokes obsolete pending invitations and delivery links, and preserves membership/audit history.

Email delivery reuses T06's durable Mailpit delivery and hashed, single-use login credentials. Confirming an invitation email verifies the exact recipient but does not claim the application; a separate **Accept invitation** action grants only the invitation's role/scope. Demo sessions cannot accept. Fresh sign-in preserves a copied invitation destination and the authenticated bank; a consumed confirmation screen cannot return after sign-out. Historical accepted invitation reads require active participation, while expired/revoked previews hide live business details. Resend invalidates prior delivery links; expired/revoked invitations cannot grant access. Concurrent acceptance serializes per application and creates one membership. Mutations and safe audit records commit together; changed payloads with reused request keys conflict.

Both Fastify and the native Worker expose validated, bank-scoped contracts and OpenAPI paths. Private resource policy primitives distinguish shared, assigned, and subject-private evidence, and deny another person's private evidence even to application administrators. Nonempty task/document grants are rejected until T12/T13 can validate actual resource records. Removal currently clears those grant lists and records `unassignedAt`; T12 must apply the same revocation transaction to its future unfinished task assignments. No task/document tables or personal identifier collection are introduced by T11.

Validation on October 7, 2026:

- `pnpm db:migrate` and `pnpm db:seed` — additive local migration and synthetic owner fixture applied without resetting records; live API reports database/worker ready.
- `pnpm check` — Biome, browser/server boundaries, all 12 workspace/root typechecks, and 202 unit tests passed.
- `pnpm test:integration` — all 162 PostgreSQL tests in 19 files passed, including policy/delegation, role/scope boundaries, verified/wrong recipients, pending/expired/revoked states, stale inviter authority, idempotency, concurrent acceptance, existing-session revocation, private owner disclosure, and both HTTP transports. Migration tests verify legacy grants/deliveries remain unchanged with empty resource defaults and repeated migration is a no-op.
- `pnpm build` — all 12 workspace tasks passed; the existing borrower bundle size warning remains nonblocking.
- `pnpm test:e2e` — final complete regression: 66 passed, 2 existing mobile fixture skips, no failures or flaky cases (`.local/e2e-rv49kZ/summary.json`). All six new participant cases run on desktop/mobile, covering lawyer invitation and active-session removal, independent owner records plus separate owner access, and Bank B copied-link recovery with verified wrong-recipient denial and cross-bank isolation. Six updated borrower/staff regression cases also passed independently. Safe mobile/desktop People/Participants screenshots were visually inspected; private local reports contain no invitation token screenshots.

Historical upgrade tests now seed explicit old-schema SQL fixtures rather than invoking a current-schema seed against missing columns. Test cleanup closes owned pools before an ordinary database drop; this avoids forced termination errors from clients still closing their sockets and continues to fail on leaked live connections. The full integration rerun passed without unhandled errors.

### Try it locally

1. For an initialized checkout, run `pnpm db:migrate` and `pnpm db:seed`, then `pnpm dev`.
2. Sign in at the borrower portal as `borrower@example.test`, open Synthetic Cedar Workshop, and choose **People**. Record an owner independently, or send an **Adviser (lawyer or accountant)** invitation to a fictional `example.test` address.
3. Open that recipient's message in the local Mailpit inbox, confirm sign-in, review the assigned scope, and choose **Accept invitation**. The collaborator sees only this application's limited summary and permitted People information.
4. Back in the administrator's browser, remove the collaborator's access. Requests from their already-open session are now denied. Test **Resend invitation** and **Revoke invitation** on a pending invitation.
5. Sign in to the bank console as `officer-a@example.test`, open **Participants**, and record an owner. This creates no user account. Send a separate owner invitation only when portal access is intended.

Task assignments/evidence adapters remain T12/T13. Hosted simulated email remains unavailable and invitation create/resend returns an explicit 503 without partial writes. No hosted migration or deployment was performed.
