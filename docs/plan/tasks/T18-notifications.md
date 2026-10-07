# T18 — Event notifications and application reminders

Dependencies: T05, T06, T09, T11, T12. Read [notification rules](../04-integrations-and-jobs.md#signatures-and-notifications).

## Outcome

Applicants receive useful local emails and can return to unfinished work without stale or excessive reminders.

## Scope

- Add typed notification records, templates, recipient resolution, delivery state, deduplication keys, and suppression preferences.
- Route application-start/resume, invitations, task assignment/return, and status changes through the existing local email adapter. Preserve purpose-scoped tokens and current access checks.
- Resolve applicant continuation destinations from current setup state after authentication: unfinished setup returns to its saved wizard step, completed setup opens the portal's remaining work. Do not trust a destination captured when the email was queued.
- Schedule idle-draft reminders using persisted last meaningful applicant activity, configurable 24/72-hour defaults, and maximum two per inactivity episode.
- Re-check activity, lifecycle, role/access, recipient verification, and suppression before delivery. Allow local fake-clock controls for demonstration.
- Register handlers for later decision/signature events as their owning features are integrated, without duplicating delivery logic.

## Acceptance criteria

- Emails contain clear application context and an authorized continuation path, never raw identifiers, private attachments, or internal risk findings.
- Normal duplicate job/event delivery produces one notification record and no intentional repeated send; SMTP crash ambiguity follows the documented stable-message-ID policy.
- Resume-link requests do not create another application. Expired original links can recover the correct pending draft after verified sign-in.
- A setup reminder resumes the correct saved question; an older link used after setup completion opens the portal. Invitation links retain their own scoped participant journey.
- Submission, withdrawal, decline, funding, revoked access, or renewed activity suppresses obsolete reminders at execution time.
- Unverified contacts receive only explicitly requested access messages; reminders respect opt-out without disabling user-requested login.
- Transient SMTP failure retries; terminal failure is visible to staff operations.

## Validation

Advance fake time through both reminder thresholds, resume before send, and revoke a recipient after scheduling. Test duplicate events, failed delivery, safe content, new inactivity episodes, and suppression. Inspect representative emails in Mailpit without sending externally.

No marketing automation or live email provider is included.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
