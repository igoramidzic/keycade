# T22 — Integrated acceptance and developer handoff

Dependencies: T01–T21, D03. Read [development/testing](../05-development-and-testing.md) and [coverage map](../07-requirements-map.md).

## Outcome

The complete local prototype is reproducible, demonstrable, and clearly bounded.

## Scope

- Run the documented end-to-end journeys across borrower, owner, adviser, and bank roles using synthetic fixtures and local providers.
- Verify a clean-clone initialization path and repeated initialization; exercise actual DB-readiness failure and persistence across restarts.
- Finish integration defects, access leaks, loading/error states, accessibility issues, and missing diagnostics found by these journeys.
- Run the established non-mutating checks, build, isolated PostgreSQL integration suite, and browser flows locally using the pinned versions. Separate CI validation remains paused under the user's explicit October 7 instruction; preserve the migration job and native Cloudflare builds. Re-enabling CI checks is deferred until requested.
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

In progress — October 7, 2026. The complete local browser suite, disposable-checkout initialization/restart checks, and hosted enrichment pass. D03's deployed synthetic inbox, setup resume, private document upload/scan, scoped invitation and two-person signing journey passed at `b9c679d`. Final hosted closing/funding verification follows a latency fix discovered during acceptance. Separate CI validation remains paused by the user's explicit decision; this is an agreed deviation from the original T22 CI scope, not a missing implementation task.

### Reproducible local setup

A fresh 425-file working-tree copy excluded `.env`, `.local`, `node_modules` and `.git`. `pnpm install --frozen-lockfile --offline` installed the pinned graph from the existing package store (500 reused, zero downloads). Process-only overrides selected an exclusively owned Podman project, database and free ports; no generated environment file required manual editing. First initialization generated a mode-0600 environment, applied all 20 migrations and seeded the $10k/$5m/$7.5m fixtures. Reinitialization preserved the environment bytes and an owned sentinel row.

Bad credentials stopped `pnpm dev` in 1.68 seconds; a stopped owned database stopped it in 1.99 seconds. Neither launched applications. Restart preserved the sentinel. Normal development then started Node 24.21.0, all three frontends, API and worker; all frontend proxies reported database/worker ready and served HTML. The owned processes, containers, volume and temporary copy were removed afterward; the shared local development containers remained running. Safe evidence: `.local/keycade-t22-6ce657ef/summary.json`, file manifest and private logs.

`pnpm db:studio` was separately opened against the final migrated local demo. Its actual UI showed the new closing schema and the $10k/$5m/$7.5m application rows. Only the verification's Studio process/tab was stopped afterward. A scan of ten built browser HTML/JS/CSS files found none of the actual local database URL, session secret or encryption key; values were never printed.

### Implementation checkpoint

Commit `5a3c1a5` passed lint/boundaries, all workspace/root types, 272 unit tests, 347 PostgreSQL tests in 39 suites, all 12 builds and native API/jobs deployment dry runs. Final closing passed 2/2 desktop/mobile journeys (`.local/e2e-vjG36g`), activity/operations 4/4 (`.local/e2e-D7lQlU`), and borrower navigation 18/18 (`.local/e2e-vkqQST`). The additive migration also applied locally; readiness reports database and worker ready.

All five native Cloudflare builds deployed `5a3c1a5`; [Neon migration run 37676993377](https://github.com/igoramidzic/keycade/actions/runs/37676993377) succeeded. Complete local browser regressions are recorded below; hosted closing/funding remains to be confirmed before T22 completion.

### Complete local browser acceptance

All **140 applicable local cases pass**: 130 existing core cases, eight private-inbox cases and two additional assigned-adviser upload/revocation cases, across desktop and mobile. The long suite ran in three independent harness databases with separate owned Mailpit containers; shared development state was untouched. Final results contain no unresolved failures or skipped applicable cases.

| Coverage | Evidence |
| --- | --- |
| Foundation, identity, intake, staff workspace | `.local/e2e-KYJc2y` initially passed 39 cases, skipped two redundant mobile fixture cases, and found three obsolete staff-test expectations. The full staff spec then passed 12/12 in `.local/e2e-BIQEFu`; both previously skipped mobile cases passed in `.local/e2e-0A3FP5`. Together these establish all 44 distinct cases. |
| Borrower workspace, participants, tasks, save conflicts, industry search | 46/46 in `.local/e2e-zP4WrF`. |
| Documents, interpretation, checks, signatures, notification preferences, review, closing, activity/operations | 40/40 in `.local/e2e-JwNs9z`. |
| Private demo inbox | 8/8 with `DEMO_INBOX_ENABLED=true` in `.local/e2e-MQISab`. |
| Invited adviser's assigned upload and active-session revocation | 2/2 in `.local/e2e-iTc2aj`. Staff downloaded the exact fixture bytes; private-owner and other-application access remained denied; revocation removed cached evidence and immediately denied task/download requests without signing out. |

The obsolete assertions expected a dashboard detour after targeted staff continuation and matched both application/account loading messages. They now assert direct saved-setup navigation and the correct loading region. Mobile identity/prefill fixture skips now apply only to concurrent direct Playwright runs; the isolated sequential runner verifies both viewports. No runtime change was needed for these final regression corrections. Deliberate synthetic screenshots were inspected; authentication traces and bearer captures were disabled.

The eight required journeys are covered as follows: (1) fresh setup/restart above plus foundation browser tests and actual Studio; (2–3) intake/borrower/staff browser suites; (4) participant and adviser-upload browser suites plus resource-isolation PostgreSQL checks; (5) document/interpretation browser and evidence-review suites; (6) stale identifier/check PostgreSQL/HTTP tests and real killed-worker restart/deduplication tests; (7) review information-request/resubmission plus two-party closing/funding browser journeys and atomic funding tests; (8) fake-time reminder/suppression/continuation PostgreSQL tests plus local/hosted inbox browser flows. Configured provider delays and injected clocks avoid waiting days to demonstrate reminders.

`pnpm db:generate` found 64 tables with **no schema drift** and produced no migration.

### Hosted acceptance and closing latency

Hosted enrichment passed against `5a3c1a5`: masked synthetic identifier capture, explicit tax authorization, prerequisite ordering and typed simulated business/tax results, without adopting suggested facts or changing application answers. See [T15's hosted evidence](T15-enrichment.md#hosted-identifier-and-enrichment-acceptance--october-7-2026).

The hosted closing journey successfully created and completed a unique synthetic application, passed its simulated checks, recorded deliberate staff approval, uploaded a private R2 signing source, accepted the restricted adviser's invitation and completed both intended signatures. Returning to Closing then exposed a 26.75–28.21 second initial load. A separate paced measurement showed successful responses but repeated sequential readiness/signature reads; the timeout was not treated as a passing journey.

The portal now returns its existing review permission as a fail-closed `canReview` flag, so navigation no longer mounts a full review query on every application section. Signature currentness is evaluated once per locked read projection, and closing reuses its already-loaded conditions/package. The cache exists only inside that evaluation; mutations create a fresh evaluation after writes. Existing application locks, current signer/document grants and funding guards remain in place. Real PostgreSQL query-count tests verify one artifact evaluation per view, immediate revocation on the next request and separate funding pre/post-write checks.

Checkpoint `4ecc0a3` contains this bounded read optimization separately from the other chat's session/polling changes. A disposable source copy with exactly this checkpoint's runtime changes, its own installed workspace graph and its own Podman project passed lint/boundaries, all types, **272 unit tests in 22 suites, 348 PostgreSQL tests in 39 suites, all 12 builds, and 18/18 borrower desktop/mobile cases**. The browser regression includes zero background review reads on unrelated sections. Safe evidence is retained in `.local/checkpoint-validation-vj0l2afe`; temporary resources were removed after validation. All five native Cloudflare builds succeeded for `4ecc0a3`. There was no schema change, so the path-filtered Neon workflow correctly did not rerun; the successful `5a3c1a5` migration remains current.

An earlier overlapping browser run encountered a transient authentication-hook ordering defect in the other chat's in-progress edits; the final isolated checkpoint excludes those changes and its full borrower rerun passes. Final review regressions and deployed timing/funding confirmation are pending.
