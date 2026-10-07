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

Not started. Record date, commands/results, and deviations when implemented.
