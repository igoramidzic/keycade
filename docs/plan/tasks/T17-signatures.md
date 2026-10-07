# T17 — Signature requests and simulated signing

Dependencies: T05, T11, T12, T13. Read [signatures](../04-integrations-and-jobs.md#signatures-and-notifications).

## Outcome

Participants complete assigned signing tasks through a DocuSign-shaped fake integration.

## Scope

- Add signature envelopes, signers, immutable document-version bindings, provider-event deduplication, and synthetic signed artifacts.
- Implement fake create/send/status/void actions and protected local signer actions. Use T06's mail/session primitives for links.
- Add borrower signing tasks and staff envelope views; distinguish one signer's completion from all signers completing.
- Add verified callback handling and legal state transitions; a local shared verification secret simulates vendor event authentication.
- Publish completed envelope evidence to its linked task through a documented system-completion rule.

## Acceptance criteria

- Only the intended verified signer can perform their action; another participant's link/session cannot sign for them.
- A two-signer envelope remains partial after the first signature and completes only after both.
- Duplicate/out-of-order events cannot reverse a terminal state or duplicate signed artifacts/task completion.
- Declined, expired, voided, failed-send, and retry states are visible and recoverable according to explicit rules.
- Replacing the source document requires a new envelope; a stale completion cannot satisfy a task for a different version.
- Every signing page/artifact is clearly simulated, with no suggestion of a real executed contract.

## Validation

Test signer authorization, callback verification, duplicate/reordered events, partial completion, decline, expiry, void, and stale versions. Run a two-participant browser journey using local inbox links and verify evidence history.

Use a sample task/document before closing exists; T20 creates actual demo closing requests through this same service. Real DocuSign credentials and live signing are deferred.

## Implementation record

Implemented October 7, 2026. Backend, shared API routes, local worker and borrower/staff interfaces passed combined browser and transport validation.

- Migration `0015_dear_next_avengers` stores scoped envelopes/signers, immutable source bindings, durable send intent, verified provider events, task policy/evidence and synthetic completion artifacts. A check-input task cannot be converted to a signature requirement.
- Staff choose a current clean source, eligible task and intended participants. A protected fake provider supports send failure/retry; signing requires an explicit, visibly simulated action by the current verified intended signer. Each signer may download their authorized source. Two signers produce a partial state until both have acted.
- Expiry, decline, void, source replacement and removed access prevent stale completion. Duplicate/reordered events cannot reverse terminal state or duplicate the immutable text artifact and task evidence. No action claims a legally executed contract.
- Both API transports expose the same signature contracts and protected artifact download. The callback verifies a purpose-derived HMAC over the exact bounded request body before accepting a typed event; it does not rely on browser session/Origin credentials. Ordinary browser mutations retain session, bank, Origin and CSRF checks.
- Email continuation resolves an authorized envelope directly and preserves the recipient's original participant scope. T18 consumes one durable notification intent per intended signer after successful simulated sending. Local SMTP is loopback Mailpit; hosted simulated access/delivery remains D03.

### Focused validation

Twenty-two signature PostgreSQL cases, three provider tests and integrations TypeScript passed in the focused backend run. New browser and both-transport integration coverage passed; see checkpoint validation below.


## Checkpoint validation

Done locally — October 7, 2026.

- `pnpm check`: Biome/browser boundaries, all workspace/root TypeScript checks, and 270 unit tests passed.
- `pnpm test:integration`: 290 tests across 31 real-PostgreSQL suites passed, including both Fastify and native Worker transports. Legacy tests now select the intended owner confirmation explicitly rather than assuming only one private task exists.
- Eight new desktop/mobile browser journeys passed in `.local/e2e-SOf9Sd/summary.json`; eighteen final regressions passed in `.local/e2e-PwIXkD/summary.json`. This covers secure-input saves/authorization reset, check review/retry/staleness, two intended signers using Mailpit continuation, immutable artifact download, source replacement, signature failure/expiry/void/decline, persisted preferences, instant task expansion, conflicts and dashboard navigation. Screenshots were inspected at both viewport sizes.
- Additive migrations 0014–0016 were applied to the local demo; `/api/ready` reports database and worker ready. `pnpm build` and native API/jobs bundle checks pass. Existing Vite chunk-size advisories remain non-fatal.
- Every provider and signature is visibly simulated. D03 tracks hosted sign-in/delivery parity; local and native-handler tests do not establish complete hosted workflow acceptance. T19/T20 remain responsible for submission/decision/funding commands; T21 assembles staff operations.
