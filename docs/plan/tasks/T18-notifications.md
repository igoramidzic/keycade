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

No marketing automation or live email provider is included in any environment. The October 7 user clarification requires production to remain a demo; D03 supplies the hosted simulated inbox/access adapter using these same notification contracts. Do not configure a real hosted email provider.

## Implementation record

Implemented October 7, 2026. Typed notification intent, contextual templates, preference controls and local runtime dispatch passed combined acceptance.

- Migration `0016_tearful_sugar_man` adds scoped notification records, per-user/bank reminder preferences and persisted applicant inactivity episodes. Existing access-delivery leases and hashed bearer-link records remain the durable email mechanism.
- Explicit access/start/resume/invitation messages are typed during preparation; transactional task assignment/return and application-status helpers create deduplicated notification intent. Successful signature sending contributes a durable signer notification. T19 will call the status helper during lifecycle commands; T21 will assemble the staff operations interface.
- The worker checks reminder scheduling once per minute. Defaults are 24 and 72 hours, configured by `REMINDER_FIRST_DELAY_MS` and `REMINDER_SECOND_DELAY_MS`. An inactivity episode can produce at most two logical reminders; a scheduler first visiting an episode after the second threshold sends only the later reminder. Injected clocks cover threshold behavior without real waits.
- Meaningful applicant writes and application continuation reset the episode. Reads, polling, staff updates and duplicate no-op actions do not count. Current activity, application state, verified recipient, active scope, task/signature version and opt-out are checked before preparing delivery and again after the simulation delay before sending.
- All email uses safe context and a short application reference; no private answers, identifiers, attachments or risk findings appear in templates. SMTP retries retain a stable message ID and the existing documented acceptance/crash ambiguity. Consuming any sibling link invalidates the others.
- Applicant links resolve current saved setup versus portal state after authentication. Signature links preserve assigned/owner scope and cannot promote a recipient to full applicant access. Reminder preferences do not disable user-requested access messages.

### Focused validation

Seventeen real-PostgreSQL notification cases passed, covering both thresholds, deduplication, new activity episodes, preference/access/lifecycle suppression, current continuation, safe content and SMTP retry. Task and secure-input regressions, audited retry/current eligibility, participant preference scope, and transport/browser coverage also passed.


## Checkpoint validation

Done locally — October 7, 2026.

- `pnpm check`: Biome/browser boundaries, all workspace/root TypeScript checks, and 270 unit tests passed.
- `pnpm test:integration`: 290 tests across 31 real-PostgreSQL suites passed, including both Fastify and native Worker transports. Legacy tests now select the intended owner confirmation explicitly rather than assuming only one private task exists.
- Eight new desktop/mobile browser journeys passed in `.local/e2e-SOf9Sd/summary.json`; eighteen final regressions passed in `.local/e2e-PwIXkD/summary.json`. This covers secure-input saves/authorization reset, check review/retry/staleness, two intended signers using Mailpit continuation, immutable artifact download, source replacement, signature failure/expiry/void/decline, persisted preferences, instant task expansion, conflicts and dashboard navigation. Screenshots were inspected at both viewport sizes.
- Additive migrations 0014–0016 were applied to the local demo; `/api/ready` reports database and worker ready. `pnpm build` and native API/jobs bundle checks pass. Existing Vite chunk-size advisories remain non-fatal.
- Every provider and signature is visibly simulated. D03 tracks hosted sign-in/delivery parity; local and native-handler tests do not establish complete hosted workflow acceptance. T19/T20 remain responsible for submission/decision/funding commands; T21 assembles staff operations.
