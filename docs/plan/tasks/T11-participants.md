# T11 — Participants, beneficial owners, and invitations

Dependencies: T09, T10. Read [domain/access rules](../03-domain-and-access.md).

## Outcome

Bank staff can invite owners and advisers into the relevant application and select the tasks they must complete. Clients cannot manage invitations.

## Scope

- Add business relationship records, scoped invitations, acceptance, expiry, resend, revoke, and participant management views on both dashboards.
- Use T06 email delivery/session primitives; invitation acceptance verifies the invited email and applies only the specified grant.
- Define participant roles and explicit application/task/document scopes, including private owner information. Implement policy primitives now; enforce them on task/document resources when those tables arrive.
- Only bank staff create, resend or revoke application invitations. Staff membership management remains separate.
- Handle participant removal by denying future access and marking their unfinished work unassigned without deleting authorship/history.

## Acceptance criteria

- An owner relationship can exist without a user account or portal grant.
- A lawyer invite defaults to restricted scope and does not grant another application or general business-wide access.
- Pending/expired/revoked invitations grant no access. Acceptance by a different email is rejected.
- A borrower cannot create, resend or revoke invitations for any role or scope, including direct API calls. Acceptance rechecks current authority; an inactive/revoked inviter's obsolete grant cannot be accepted.
- Removing a participant invalidates future reads/writes through their existing session immediately.
- Invite/revoke/resend operations are audited and idempotent; concurrent acceptance creates one membership.

## Validation

Test a complete role/scope matrix, duplicate/replayed acceptance, expiration, same-email existing identity, wrong recipient, privilege escalation, and active-session revocation. Run lender-invites-lawyer-with-selected-tasks and staff-adds-owner browser journeys through the simulated local inbox. Verify the client dashboard has no invitation controls.

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
2. Sign in at the bank console as `officer-a@example.test`, open Synthetic Cedar Workshop, and choose **Participants**. Choose **Invite participant**, pick **Adviser**, enter a fictional `example.test` address and select their **Tasks to complete**.
3. Open that recipient's message in the local Mailpit inbox, confirm sign-in, review the assigned scope, and choose **Accept invitation**. The collaborator sees only this application's limited summary and permitted People information.
4. Back in the lender's browser, open the collaborator's card menu (⋯) and choose **Remove access**, then confirm. Requests from their already-open session are now denied. A pending invitation's card menu offers **Resend invitation** and **Revoke invitation**; an active participant's menu also offers **Edit assigned tasks**.
5. Sign in to the bank console as `officer-a@example.test`, open **Participants**, and choose **Record owner**. This creates no user account. Send a separate owner invitation only when portal access is intended.

Task assignments/evidence adapters remain T12/T13. Hosted simulated email remains unavailable and invitation create/resend returns an explicit 503 without partial writes. No hosted migration or deployment was performed.

### Lender-only invitations and task assignments — October 8, 2026

Done — implemented and verified locally October 8, 2026. This supersedes the original borrower invitation policy above.

- Client People retains permitted participant and owner information, without invite/resend/revoke controls or invitation records. The shared service enforces staff-only invitation authority in both HTTP transports; legacy borrower-created invitations fail acceptance until renewed by staff.
- Lender Application → Participants exposes **Tasks to complete** for every invited application role. Selected unfinished, non-private, non-signature tasks transfer to the invitee on acceptance. Lenders can also assign tasks later using the existing Tasks controls.
- Assignment intent carries expected task revisions. Acceptance validates all selections before committing; changed/completed/private/cross-application tasks cannot create partial grants or overwrite newer work. Duplicate acceptance creates one assignment history/audit entry per selected task.
- Existing visibility-only invitation grants remain compatible. Migration `0020_reflective_nekra.sql` adds empty assignment intent by default; no data reset. Real authentication and email remain out of scope.

Validation used the repository’s Node 24.21.0 and cached pnpm 10.34.6:

- `pnpm db:migrate` — applied additive migration 0020 to the existing project-local database without reset. Upgrade tests preserve existing invitation/participant records, default old assignment intent to empty and verify repeated migration is a no-op.
- `pnpm check` — Biome, browser/server boundaries, all workspace/root typechecks and **298 unit tests** passed. Final Biome verification also passed after fixture/copy cleanup.
- `pnpm build` — **12/12 workspace builds** passed; existing non-fatal Vite bundle-size advisories remain.
- `pnpm test:integration` — the final full run passed **367/368 cases**; the sole failure was a newly added completed-task fixture missing positive reviewed evidence. Corrected the fixture and reran all **9/9 participant-task cases** successfully against fresh PostgreSQL, completing coverage of all **368 cases in 39 files**. The earlier run also identified two delivery-disabled tests still inviting as a client; both now use staff and pass, preserving `AUTH_DELIVERY_UNAVAILABLE` behavior.
- Both Fastify and the native Worker verify client create/resend/revoke denial, staff permissions, selected assignment on acceptance, CSRF, duplicate acceptance, tenant boundaries and existing-session revocation. Domain tests cover multiple selections, actual recipient answer/submission, no access to unselected tasks, no partial grants on stale selection, invalid task state/privacy/tenant and legacy borrower invitations.
- `pnpm test:e2e participants.spec.ts` — **6/6 desktop/mobile journeys** passed, no skips/failures/flakes (`.local/e2e-ZHPPAU/summary.json`). The lender selects a task, the invited adviser accepts and submits it, and removal denies their existing session. The client has no create/resend/revoke controls. Owner recording/separate access and Bank B invitation recovery/wrong-recipient checks also pass. Desktop/mobile lender screenshots were visually inspected.

At this local checkpoint, hosted deployment was not included and migration 0020 was required before the updated API/jobs deployment. Existing borrower-issued pending invitations need lender renewal; previously accepted memberships remain unchanged.

## V2 hosted deployment follow-up — October 8, 2026

The lender-only invitation implementation and migration 0020 are included in the five-Worker release at `75b1f96`; all 25 migrations are applied. [V2-08 hosted acceptance](../v2/04-delivery-and-validation.md#v2-08--hosted-parity-and-deployment-slice) verifies simulated inbox access and unrelated-applicant denials. The invitation/assignment matrix above remains locally verified and was not rerun as part of this smaller hosted slice. Existing borrower-issued pending invitations still need lender renewal; previously accepted memberships remain unchanged.

### Participants cards, menus and modals — October 8, 2026

Done — implemented and validated locally October 8, 2026, at the user's request to make adding, editing and removing participants simpler.

- **People with portal access** is a wrapping grid of cards: initials, name, email, role, access scope and (for the lender) open-task count. Pending and expired invitations appear as dashed cards with delivery status. Past access and accepted/revoked invitations move into a collapsed **Past access and invitations** history.
- Each card has a “⋯” menu (**Actions for …**). Participants: **Edit assigned tasks** (lender) and **Remove access**. Invitations: **Resend invitation** and **Revoke invitation**. Owners: **Link to participant** and **Mark relationship inactive**/**Restore relationship**.
- **Invite participant**, **Record owner**, **Link to participant** and **Edit assigned tasks** open modal dialogs that keep entries after a failed save; **Remove access** and **Revoke invitation** confirm first. Role is chosen from described Adviser/Owner/Applicant administrator options, and the implied access scope is stated instead of a disabled select.
- **Edit assigned tasks** offers the same unfinished, non-private, non-signature tasks as invitations and applies changes through the existing revision-checked `PATCH …/tasks/:taskId/assignment` command, stopping at the first failure and refreshing tasks and participants. Checking a task replaces its assignee; unchecking unassigns it.
- The client People page shares the component; it still has no invitation controls. No backend contract, permission, schema or dependency change.

Acceptance: open and cancel the invite dialog; invite with selected tasks; accept and remove access through the card menu and confirmation; record an owner in its dialog; keep the client view free of invitation controls; no overflow on desktop or mobile.

Validation (shared with the other October 8 UI follow-ups in this change):

- `pnpm lint` (Biome and browser/server boundaries), root `tsc --noEmit` including `tests/`, and the shared UI, bank-console, borrower and bank-site typechecks pass. `pnpm test`: **425 unit tests** pass. All three web Vite builds pass (existing large-chunk warnings remain).
- `pnpm test:e2e` with `participants`, `collaborator-upload`, `staff-workspace`, `borrower-workspace`, `intake`, `demo-inbox` and `lender-overview-v2` (`.local/e2e-utpAIY`): **74 desktop/mobile cases — 65 passed, 8 skipped, 1 failed, 0 flaky**. The skips are the eight `demo-inbox` cases, which run only when `DEMO_INBOX_ENABLED=true`. The failure was the mobile *queue loading and service failure* case: by then the combined run had created 55 applications, pushing the seeded Synthetic Cedar Workshop off the first queue page. Rerun alone, it passed on desktop and mobile (2/2, `.local/e2e-ouo2wc`).
- Browser inspection against the local stack at 1280px and 375px (no horizontal overflow). The card grid, menus, invite and edit-tasks dialogs, focus return to the triggering control and the mobile layout were checked. All six participant journeys and both collaborator-upload journeys pass with the menu-and-confirm removal flow (`tests/e2e/participant-helpers.ts`). The hosted invitation step in `hosted-demo.spec.ts` was updated but not run (hosted-only). No hosted deployment was performed.
