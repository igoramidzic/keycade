# T22 — Integrated acceptance and developer handoff

Dependencies: T01–T21, D03. Read [development/testing](../05-development-and-testing.md) and [coverage map](../07-requirements-map.md).

## Outcome

The complete local prototype is reproducible, demonstrable, and clearly bounded.

## Scope

- Run the documented end-to-end journeys across borrower, owner, adviser, and bank roles using synthetic fixtures and local providers.
- Verify a clean-clone initialization path and repeated initialization; exercise actual DB-readiness failure and persistence across restarts.
- Finish integration defects, access leaks, loading/error states, accessibility issues, and missing diagnostics found by these journeys.
- Add CI jobs for the established non-mutating checks, build, isolated PostgreSQL integration suite, and selected browser flows using the same pinned versions. CI may use its platform's PostgreSQL service container; local setup remains Podman.
- Update the root README with exact setup/demo commands, synthetic identities/inbox access, fixture controls, known limitations, and troubleshooting.

## Acceptance criteria

- Repeat the core demo journeys on the hosted production URL using simulated authentication/delivery and synthetic fixtures. No real auth/email provider, external email or real financial action is required or performed; D03 removes hosted-only access blockers.

- All eight journeys in the development guide pass, including amounts $10k/$5m/$7.5m, multiple applications, restricted adviser access, delayed processing, and recorded funding.
- Borrower setup asks one question per screen, persists answers/step state, resumes after browser/session loss, and blocks portal entry until explicit completion. Verify failed saves/completion, staff-prefilled drafts, per-application isolation, and correct return to the remaining-task portal after completion.
- Restart, duplicate delivery, stale results, link expiry, bad credentials, revoked access, and provider failures have verified recovery/denial behavior.
- Fresh setup and repeated setup need no manual env editing for standard defaults; no secrets or real data are committed.
- Relevant lint, type, build, unit, PostgreSQL, and browser checks pass with recorded results; no feature is marked done based only on a screenshot.
- Borrower forms support keyboard navigation, readable error/status announcements, and narrow mobile layouts.
- All simulation labels remain visible. README accurately says that live providers, production banking readiness, SSO, and servicing are future work.

## Validation

Use a clean disposable checkout/database and an independently seeded fixture set. Record commands/results and the demonstration path. Confirm every requirement maps to implemented, tested behavior or an explicit agreed deferral.

This is integration verification, not permission to postpone earlier task tests. Do not add new lending features or deploy a production service as part of handoff.

## Implementation record

Not started. Record date, commands/results, and deviations when implemented.
