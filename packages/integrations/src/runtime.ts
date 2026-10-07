import { createDatabase, type Database, workerHeartbeats } from "@keycade/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { dispatchAccessDeliveries, processAccessDelivery } from "./access-delivery.js";
import type { AccessEmailAdapter } from "./mailpit.js";
import {
  configured,
  deliverOutbox,
  processOperation,
  type RuntimeOptions,
  recoverExpiredRuns,
} from "./operations.js";
import { type Clock, systemClock } from "./provider.js";
import { accessQueue, assertQueueReady, createQueueClient, demoQueue } from "./queue.js";

export { processOperation, type RuntimeOptions, recoverExpiredRuns } from "./operations.js";

export function dispatchOutbox(
  db: Database,
  boss: PgBoss,
  clock: Clock = systemClock,
  afterSend?: () => Promise<void>,
) {
  return deliverOutbox(
    db,
    async (message) => {
      if (!(await boss.send(demoQueue, message)))
        throw new Error("Queue rejected durable delivery.");
    },
    clock,
    afterSend,
  );
}

export async function workerHealth(
  pool: ReturnType<typeof createDatabase>["pool"],
  staleMs: number,
): Promise<{ ready: boolean; lastSeenAt: string | null }> {
  const result = await pool.query<{ seen_at: Date; ready: boolean }>(
    "SELECT seen_at, seen_at >= now() - ($1::double precision * interval '1 millisecond') AS ready FROM worker_heartbeats ORDER BY seen_at DESC LIMIT 1",
    [staleMs],
  );
  return {
    ready: result.rows[0]?.ready ?? false,
    lastSeenAt: result.rows[0]?.seen_at.toISOString() ?? null,
  };
}

export async function startWorker(
  connectionString: string,
  options: RuntimeOptions & { emailAdapter?: AccessEmailAdapter } = {},
) {
  await assertQueueReady(connectionString);
  const config = configured(options);
  const { db, pool } = createDatabase(connectionString);
  const boss = createQueueClient(connectionString, false, true);
  const abort = new AbortController();
  let queueError = false;
  boss.on("error", () => {
    queueError = true;
    abort.abort();
  });
  const heartbeat = async () => {
    await db
      .insert(workerHeartbeats)
      .values({
        workerId: config.workerId,
        seenAt: config.clock.now(),
        startedAt: config.clock.now(),
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { seenAt: config.clock.now() },
      });
  };
  try {
    await boss.start();
    if (queueError) throw new Error("Worker queue startup failed.");
    await heartbeat();
  } catch (error) {
    try {
      await boss.stop();
    } finally {
      await pool.end();
    }
    throw error;
  }
  let heartbeatError = false;
  let pendingHeartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pendingHeartbeat) return;
    pendingHeartbeat = heartbeat()
      .catch(() => {
        heartbeatError = true;
        abort.abort();
      })
      .finally(() => {
        pendingHeartbeat = undefined;
      });
  }, config.heartbeatMs);
  const done = (async () => {
    while (!abort.signal.aborted) {
      await recoverExpiredRuns(db, config.clock, config.leaseMs);
      await dispatchOutbox(db, boss, config.clock);
      if (options.emailAdapter) {
        await dispatchAccessDeliveries(
          db,
          async (message) => {
            if (!(await boss.send(accessQueue, message)))
              throw new Error("Queue rejected access delivery.");
          },
          config.clock,
        );
        const deliveries = await boss.fetch<{ deliveryRequestId: string }>(accessQueue, {
          batchSize: 5,
        });
        for (const job of deliveries) {
          await processAccessDelivery(db, job.data.deliveryRequestId, options.emailAdapter, {
            clock: config.clock,
            delayMs: Math.min(config.delayMs, 1000),
          });
          await boss.complete(accessQueue, job.id);
        }
      }
      const jobs = await boss.fetch<{ operationId: string }>(demoQueue, { batchSize: 5 });
      const outcomes = await Promise.allSettled(
        jobs.map(async (job) => {
          try {
            await processOperation(db, job.data.operationId, config, abort.signal);
            await boss.complete(demoQueue, job.id);
          } catch (error) {
            abort.abort();
            throw error;
          }
        }),
      );
      if (outcomes.some((outcome) => outcome.status === "rejected"))
        throw new Error("Worker operation failed.");
      try {
        await config.clock.sleep(config.pollMs, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    }
    if (heartbeatError) throw new Error("Worker heartbeat failed.");
    if (queueError) throw new Error("Worker queue failed.");
  })();
  // Install a rejection handler immediately; callers still observe rejection through done.
  void done.catch(() => {
    abort.abort();
    clearInterval(timer);
  });
  let stopped = false;
  return {
    done,
    workerId: config.workerId,
    async stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      clearInterval(timer);
      try {
        await done;
      } catch {
        /* caller observes failure through done */
      }
      try {
        await pendingHeartbeat;
        await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, config.workerId));
      } finally {
        try {
          await boss.stop();
        } finally {
          await pool.end();
        }
      }
    },
  };
}
