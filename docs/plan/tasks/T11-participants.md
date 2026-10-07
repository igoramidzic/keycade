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

Not started. Record date, commands/results, and deviations when implemented.
