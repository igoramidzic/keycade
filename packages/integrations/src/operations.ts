import { randomUUID } from "node:crypto";
import {
  applications,
  auditEvents,
  type Database,
  effectDeduplications,
  integrationRuns,
  outboxEvents,
} from "@keycade/db";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  type Clock,
  demoResultSchema,
  invokeDemoProvider,
  ProviderError,
  systemClock,
} from "./provider.js";

export interface RuntimeOptions {
  clock?: Clock;
  delayMs?: number;
  deadlineMs?: number;
  leaseMs?: number;
  retryBaseMs?: number;
  pollMs?: number;
  heartbeatMs?: number;
  workerId?: string;
}
export function configured(options: RuntimeOptions = {}) {
  const deadlineMs = options.deadlineMs ?? 60_000;
  return {
    clock: options.clock ?? systemClock,
    delayMs: options.delayMs ?? 2000,
    deadlineMs,
    leaseMs: options.leaseMs ?? deadlineMs + 1000,
    retryBaseMs: options.retryBaseMs ?? 1000,
    pollMs: options.pollMs ?? 500,
    heartbeatMs: options.heartbeatMs ?? 2000,
    workerId: options.workerId ?? randomUUID(),
  };
}

/** Queue send/mark crashes may redeliver; operation IDs fence application effects. */
export async function deliverOutbox(
  db: Database,
  send: (message: { operationId: string }) => Promise<unknown>,
  clock: Clock = systemClock,
  afterSend?: () => Promise<void>,
): Promise<number> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({ event: outboxEvents, run: integrationRuns })
      .from(outboxEvents)
      .innerJoin(integrationRuns, eq(outboxEvents.runId, integrationRuns.id))
      .where(
        and(
          isNull(outboxEvents.dispatchedAt),
          lte(integrationRuns.availableAt, clock.now()),
          sql`${integrationRuns.status} IN ('queued', 'retry_scheduled')`,
        ),
      )
      .limit(25)
      .for("update", { of: outboxEvents, skipLocked: true });
    for (const { event } of pending) {
      await send({ operationId: event.runId });
      await afterSend?.();
      await tx
        .update(outboxEvents)
        .set({ dispatchedAt: clock.now() })
        .where(eq(outboxEvents.id, event.id));
    }
    return pending.length;
  });
}

export async function recoverExpiredRuns(
  db: Database,
  clock: Clock = systemClock,
  deliveryLeaseMs = 61_000,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Covers a process dying after queue fetch but before an application lease was claimed.
    await tx.execute(sql`UPDATE outbox_events o SET dispatched_at = NULL FROM integration_runs r
      WHERE o.run_id = r.id AND r.status IN ('queued', 'retry_scheduled')
      AND o.dispatched_at <= ${new Date(clock.now().getTime() - deliveryLeaseMs)}`);
    const expired = await tx
      .select()
      .from(integrationRuns)
      .where(
        and(eq(integrationRuns.status, "running"), lte(integrationRuns.leaseUntil, clock.now())),
      )
      .for("update", { skipLocked: true });
    for (const run of expired) {
      const exhausted = run.attempts >= run.maxAttempts;
      await tx
        .update(integrationRuns)
        .set({
          status: exhausted ? "failed" : "retry_scheduled",
          lastErrorCode: exhausted ? "attempts_exhausted_after_restart" : "worker_lease_expired",
          claimToken: null,
          leaseUntil: null,
          availableAt: clock.now(),
          updatedAt: clock.now(),
        })
        .where(eq(integrationRuns.id, run.id));
      if (!exhausted)
        await tx
          .update(outboxEvents)
          .set({ dispatchedAt: null })
          .where(eq(outboxEvents.runId, run.id));
    }
  });
}

export async function processOperation(
  db: Database,
  operationId: string,
  options: RuntimeOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const config = configured(options);
  const claimToken = randomUUID();
  const run = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(integrationRuns)
      .where(eq(integrationRuns.id, operationId))
      .for("update");
    if (
      !current ||
      !["queued", "retry_scheduled"].includes(current.status) ||
      current.availableAt > config.clock.now() ||
      current.attempts >= current.maxAttempts
    )
      return undefined;
    const [application] = await tx
      .select()
      .from(applications)
      .where(
        and(eq(applications.id, current.applicationId), eq(applications.bankId, current.bankId)),
      );
    const stale = application?.revision !== current.inputRevision;
    if (
      !application ||
      !application.synthetic ||
      stale ||
      ["withdrawn", "declined", "funded"].includes(application.status)
    ) {
      await tx
        .update(integrationRuns)
        .set({
          status: "cancelled",
          stale,
          lastErrorCode: stale ? "stale_input" : "no_longer_applicable",
          updatedAt: config.clock.now(),
        })
        .where(eq(integrationRuns.id, operationId));
      return undefined;
    }
    const [claimed] = await tx
      .update(integrationRuns)
      .set({
        status: "running",
        attempts: current.attempts + 1,
        claimToken,
        leaseUntil: new Date(config.clock.now().getTime() + config.leaseMs),
        updatedAt: config.clock.now(),
      })
      .where(eq(integrationRuns.id, operationId))
      .returning();
    return claimed;
  });
  if (!run) return;
  let result: ReturnType<typeof demoResultSchema.parse> | undefined;
  let failure: ProviderError | undefined;
  try {
    result = demoResultSchema.parse(
      await invokeDemoProvider(
        {
          operationId,
          applicationId: run.applicationId,
          bankId: run.bankId,
          inputRevision: run.inputRevision,
          idempotencyKey: operationId,
          requestId: run.requestId,
          scenario: run.scenario,
          attempt: run.attempts,
        },
        { clock: config.clock, delayMs: config.delayMs, deadlineMs: config.deadlineMs, signal },
      ),
    );
  } catch (error) {
    failure = error instanceof ProviderError ? error : new ProviderError("terminal_error", false);
  }
  if (failure?.code === "aborted") {
    await db
      .update(integrationRuns)
      .set({ leaseUntil: config.clock.now() })
      .where(
        and(
          eq(integrationRuns.id, operationId),
          eq(integrationRuns.claimToken, claimToken),
          eq(integrationRuns.status, "running"),
        ),
      );
    return;
  }
  await db.transaction(async (tx) => {
    // Lock current input and operation while validating/applying so concurrent draft edits serialize.
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, run.applicationId), eq(applications.bankId, run.bankId)))
      .for("update");
    const [current] = await tx
      .select()
      .from(integrationRuns)
      .where(eq(integrationRuns.id, operationId))
      .for("update");
    if (
      !current ||
      current.claimToken !== claimToken ||
      current.status !== "running" ||
      !current.leaseUntil ||
      current.leaseUntil <= config.clock.now()
    )
      return;
    const stale = application?.revision !== run.inputRevision;
    if (
      !application ||
      !application.synthetic ||
      stale ||
      ["withdrawn", "declined", "funded"].includes(application.status)
    ) {
      await tx
        .update(integrationRuns)
        .set({
          status: "cancelled",
          stale,
          claimToken: null,
          leaseUntil: null,
          lastErrorCode: stale ? "stale_input" : "no_longer_applicable",
          updatedAt: config.clock.now(),
        })
        .where(eq(integrationRuns.id, operationId));
      return;
    }
    if (failure) {
      const retry = failure.retryable && current.attempts < current.maxAttempts;
      await tx
        .update(integrationRuns)
        .set({
          status: retry
            ? "retry_scheduled"
            : failure.code === "deadline_exceeded"
              ? "timed_out"
              : "failed",
          lastErrorCode: failure.code,
          claimToken: null,
          leaseUntil: null,
          updatedAt: config.clock.now(),
          availableAt: new Date(
            config.clock.now().getTime() + config.retryBaseMs * 2 ** (current.attempts - 1),
          ),
        })
        .where(eq(integrationRuns.id, operationId));
      if (retry)
        await tx
          .update(outboxEvents)
          .set({ dispatchedAt: null })
          .where(eq(outboxEvents.runId, operationId));
      return;
    }
    if (!result || result.operationId !== operationId || result.inputRevision !== run.inputRevision)
      throw new Error("Invalid provider result identity.");
    if (result.outcome === "complete") {
      const inserted = await tx
        .insert(effectDeduplications)
        .values({ operationId, bankId: run.bankId, applicationId: run.applicationId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length)
        await tx.insert(auditEvents).values({
          bankId: run.bankId,
          applicationId: run.applicationId,
          actorType: "system",
          action: "simulation.completed",
          targetType: "integration_run",
          targetId: operationId,
          requestId: run.requestId,
          metadata: { simulated: true, provider: result.provider },
        });
    }
    await tx
      .update(integrationRuns)
      .set({
        status: result.outcome === "complete" ? "succeeded" : "waiting_for_input",
        result,
        claimToken: null,
        leaseUntil: null,
        lastErrorCode: null,
        updatedAt: config.clock.now(),
      })
      .where(eq(integrationRuns.id, operationId));
  });
}
