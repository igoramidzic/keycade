# D03 — Hosted demo authentication and delivery parity

Dependencies: D02, T06, T18. Read [the all-environment decision](../06-decisions-and-sources.md#all-environments-are-demos--october-7-2026).

## Outcome

The production URL runs the same synthetic demo journeys as local without real authentication or email services.

## Reported failure

On October 7, the user encountered `AUTH_DELIVERY_UNAVAILABLE` with the message “Email sign-in is available in the local demo. Hosted email delivery is not configured.” Request reference: `6364935f-f414-4ebe-8550-5ac9bcc1eb06`.

The hosted API currently disables demo sign-in and email delivery. This is an implementation gap, not a requirement to set up real email. Earlier local-only assumptions are superseded by the user's explicit clarification.

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

Not started. Instruction and failure recorded October 7, 2026 at the user's request; no real provider setup is planned.
