# T05 — Durable jobs and provider contracts

Dependencies: T04. Read [integration contracts](../04-integrations-and-jobs.md).

## Outcome

Background work survives restarts and supports deterministic delayed simulations.

## Scope

- Add pg-boss, its supported database initialization, an independent worker entry point, and graceful shutdown.
- Add outbox, integration-run, effect-deduplication, and heartbeat records. Business transactions persist intent; a dispatcher safely retries delivery.
- Define provider interfaces, scenario fixtures, typed results, injected clocks, deadlines, retry policy, and simulated provenance.
- Implement one harmless sample adapter/operation to exercise success, waiting input, transient error, timeout, and terminal failure. Feature tasks add real domain adapters.
- Connect queue/worker startup to initialize/dev and expose safe structured diagnostics.

Cloudflare boundary: The pg-boss process is the local Node runner, not a provisioned Cloudflare Worker. Keep durable intent, provider contracts, and effect application separable from delivery/scheduling so a future Cloudflare Queues/Workflows adapter can preserve the same invariants.

## Acceptance criteria

- A transaction rollback does not enqueue observable work; a committed intent is eventually delivered after a dispatcher restart.
- Duplicate dispatch and concurrent delivery produce one logical business effect.
- Restarting mid-job preserves recoverable state; exhausted retries become visible terminal failures.
- A response for an old input revision cannot update current state.
- Demo latency is configurable; adapter/domain timing tests use an injected clock. Real queue recovery tests use bounded polling with short test-specific timings.
- Worker absence/failure is visible in readiness/heartbeat metadata without falsely reporting checks complete.

## Validation

Use real PostgreSQL to test outbox crash boundaries, duplicate dispatch, worker restart, attempt limits, stale results, and cancellation. Unit-test the adapter contract and time controls. Record a manual delayed job demonstration with status transitions.

Do not add a general-purpose public job submission endpoint. Email, documents, fraud, tax, and signing adapters arrive in their own tasks.

## Implementation record

Implemented October 6, 2026. `packages/integrations` separates the portable simulated provider contract, transactional intent creation, pg-boss transport adapter, and Node worker runtime. `apps/worker` is independently runnable and handles SIGINT/SIGTERM. Migration `0001` adds integration runs, transactional outbox, effect deduplication, and worker heartbeats; pg-boss 12.37.0 owns its own schema through its supported startup lifecycle.

Validation:

- Six provider unit tests pass using an injected clock with no real sleeps: configurable latency, deadlines, missing input, transient recovery, and terminal versus retryable errors.
- Eight real PostgreSQL job integration tests pass (2.84 seconds in the targeted run): transaction rollback; dispatcher send-before-mark crash; duplicate/concurrent deliveries producing one effect; restart after queue fetch but before the application claim; interrupted provider recovery; stale revision and withdrawal cancellation; missing/transient/terminal/timeout/exhausted states; expired claim fencing; and heartbeat presence/absence.
- The eighth integration test launches a separate Node worker process, waits for a persisted running attempt, sends SIGKILL, observes the stale heartbeat, starts a replacement, and verifies success on attempt two with one logical effect. Recovery uses bounded polling and short test-only leases.
- Integration, database, and worker TypeScript checks pass; Biome checks pass for these packages. The full workspace commands are recorded in the milestone handoff.
- Manual local demonstrations confirmed `queued → running → succeeded` in one attempt, a transient failure through `retry_scheduled` then success in two attempts, and `waiting_for_input` with no effect. All returned provider results explicitly include simulated provenance.

Recovery details: separate dispatch and acknowledgement deliberately permit duplicate delivery; a transactionally written outbox persists intent. Expired application leases and expired dispatch leases recover both sides of the fetch/claim crash boundary. Fencing tokens, application revision/lifecycle checks, and an effect uniqueness key prevent duplicate or stale effects. pg-boss supervision expires and cleans orphaned transport jobs. Retry exhaustion remains visible in application-owned run history. Worker errors stop the worker; startup/readiness does not silently initialize a missing queue schema.

Only the harmless registered synthetic operation is implemented, via protected local CLI tooling. No public arbitrary-job endpoint or external provider calls exist. The pg-boss transport and Node runtime are the local development implementation; the subsequent Cloudflare deployment adaptation remains a separate task as documented in the decisions file.
