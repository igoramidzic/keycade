# D07 — Account picker and product wording

Dependencies: T06, T08, D03, D05, V2-08. This is the October 9, 2026 user-requested follow-up to the completed authentication and hosted parity work.

## Outcome and changed direction

The lender sign-in screen lists existing active accounts for the selected bank. Borrowers continue by entering an email. Neither entry screen offers the alternate email-link switch or displays an example email or the obsolete hosted-delivery notice.

The user's follow-up explicitly extends removal of demo wording to the entire lender console, borrower dashboard, setup wizard and bank website. This supersedes earlier requirements for visible demo/simulation labels in these product screens. Sample tooling remains available with neutral labels. Provider execution, synthetic-only data/access, inbox delivery, authorization, signature semantics and funding behavior remain unchanged. This request does not authorize real email, external identity verification or money movement.

## Acceptance criteria

- Both Fastify and Workers list only active, synthetic staff memberships and synthetic users in the selected synthetic bank, with email and role only. The listing requires the existing explicit runtime flag. Unknown banks return no choices; no public listing can create membership or restore revoked access.
- The lender picker supports initial loading, empty results, failures with retry, persisted selection during sign-in failure and successful sign-in/sign-out. Another bank's account is not offered; the existing sign-in endpoint still enforces current membership.
- Both sign-in pages omit the email-link switch, example-email block and obsolete hosted-delivery notice. Borrower start/resume and deliberate confirmation of existing invitation/recovery links remain functional.
- Product chrome uses ordinary names for inboxes, checks, signatures, document interpretation, review, closing, funding and setup. User-authored business/contact names, saved data, internal identifiers, wire contracts and immutable evidence are preserved; presentation mapping handles existing built-in display fixtures and server-authored workflow labels.
- Relevant types, lint, unit tests, real PostgreSQL transport/security checks, desktop/mobile journeys and hosted build/deployment checks are recorded before claiming completion.

## Implementation record

Complete locally; production publication pending — October 9, 2026. Public account choices come from a bank-scoped database query in the existing identity service, shared by both API transports. The UI uses the existing Keycade NativeSelect primitive. No schema migration, new account signup, real provider or email service is introduced. Existing hosted fixture preparation already provides `officer-a@example.test` in Bank A; Bank B's local fixture remains isolated.

Shared component copy and server-authored presentation labels are updated across all three interfaces. Backend simulation markers and stored evidence remain unchanged. Email links remain an integration/recovery capability, while the normal sign-in pages show only immediate access. Existing email-flow browser fixtures now request links through the API instead of a removed UI switch.

Validation recorded on October 9:

- `pnpm lint` and browser credential boundaries pass; all 12 workspace typechecks plus the root TypeScript check pass.
- `pnpm test`: **426 tests in 40 suites passed**.
- `pnpm test:integration`: **487 tests in 50 suites passed**, including both transports' bank-scoped account listing, disabled mode, real-user/membership filtering and revoked-account denial.
- Identity, foundation and intake: **38 desktop/mobile browser cases passed** in `.local/e2e-h2Q3Vo`. This covers immediate access, current-bank choices, an empty bank, load failure/retry, selected-account retention, logout, existing-link confirmation, setup persistence and application entry. Desktop/mobile setup screenshots were inspected.
- **10 additional distinct desktop workflow cases pass**: geographic eligibility (3), review/resubmission (1), document preview/reanalysis/quarantine (3), sample-kit layout (1), two intended signers (1), and closing through funding/replay/scoped account visibility (1). The seven first cases passed in `.local/e2e-xzeKkp`; corrected copy assertions passed in `.local/e2e-c3zGej` (kit), `.local/e2e-oJhhZd` (signatures) and `.local/e2e-Z2hsxa` (closing). Together with the entry/setup suite, **48 distinct relevant browser cases pass**. The initial broad run overlapped wording edits and was stopped; it is not claimed as a passing suite. Obsolete assertions for removed labels were updated, and the paced multi-actor review/signature fixtures park inactive pages so their polling does not delay the next actor.
- `KEYCADE_DEPLOYMENT=cloudflare pnpm build`: **all 12 workspace builds pass**. Wrangler `deploy --dry-run` succeeds for all five Workers against the final production bundles. No secrets, database migrations or runtime flags were changed.

Production publication and a live hosted acceptance run are pending. These changes have not been committed, pushed or deployed by this task; dry-run success is not a production release. Existing fixture PDFs, original filenames and extracted source values keep their source/evidence contents. Product chrome, generated workflow labels and built-in display names use neutral wording.
