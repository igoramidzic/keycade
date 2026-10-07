import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  applications,
  auditEvents,
  effectDeduplications,
  integrationRuns,
  outboxEvents,
} from "@keycade/db";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { enqueueDemo } from "./intent.js";
import { type DemoScenario, systemClock } from "./provider.js";
import { assertQueueReady, createQueueClient, demoQueue, initializeQueue } from "./queue.js";
import {
  dispatchOutbox,
  processOperation,
  recoverExpiredRuns,
  startWorker,
  workerHealth,
} from "./runtime.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let boss: ReturnType<typeof createQueueClient>;
const options = {
  delayMs: 10,
  deadlineMs: 100,
  leaseMs: 200,
  retryBaseMs: 5,
  pollMs: 10,
  heartbeatMs: 50,
};
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  await initializeQueue(database.connectionString);
  await initializeQueue(database.connectionString);
  await assertQueueReady(database.connectionString);
  boss = createQueueClient(database.connectionString);
  await boss.start();
}, 30_000);
afterAll(async () => {
  await boss?.stop();
  await database?.cleanup();
});
const intent = (scenario: DemoScenario = "success", maxAttempts = 3) =>
  database.db.transaction((tx) =>
    enqueueDemo(tx, {
      bankId: seedIds.bankA,
      applicationId: seedIds.applicationSmall,
      scenario,
      maxAttempts,
      requestId: "synthetic-integration-test",
    }),
  );
const run = async (id: string) =>
  (await database.db.select().from(integrationRuns).where(eq(integrationRuns.id, id)))[0];
async function until(check: () => Promise<boolean>, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error("Bounded PostgreSQL condition timed out.");
    await systemClock.sleep(10);
  }
}

it("rolls back durable intent and produces no observable queue work", async () => {
  const before = await database.db.select().from(outboxEvents);
  await expect(
    database.db.transaction(async (tx) => {
      await enqueueDemo(tx, {
        bankId: seedIds.bankA,
        applicationId: seedIds.applicationSmall,
        scenario: "success",
        requestId: "rollback",
      });
      throw new Error("Rollback");
    }),
  ).rejects.toThrow("Rollback");
  expect(await database.db.select().from(outboxEvents)).toHaveLength(before.length);
  expect(await dispatchOutbox(database.db, boss)).toBe(0);
  expect(await boss.fetch(demoQueue)).toHaveLength(0);
});

it("survives send-before-mark failure and deduplicates concurrent repeated deliveries", async () => {
  const id = await intent();
  await expect(
    dispatchOutbox(database.db, boss, systemClock, async () => {
      throw new Error("Synthetic dispatcher crash");
    }),
  ).rejects.toThrow();
  await dispatchOutbox(database.db, boss);
  const jobs = await boss.fetch<{ operationId: string }>(demoQueue, { batchSize: 10 });
  expect(jobs.filter((job) => job.data.operationId === id)).toHaveLength(2);
  await Promise.all(
    jobs.map((job) => processOperation(database.db, job.data.operationId, options)),
  );
  await boss.complete(
    demoQueue,
    jobs.map((job) => job.id),
  );
  expect((await run(id))?.status).toBe("succeeded");
  expect(
    await database.db
      .select()
      .from(effectDeduplications)
      .where(eq(effectDeduplications.operationId, id)),
  ).toHaveLength(1);
  expect(
    await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, id), eq(auditEvents.action, "simulation.completed"))),
  ).toHaveLength(1);
});

it("recovers a queued operation after transport fetch but before application claim", async () => {
  const id = await intent();
  await dispatchOutbox(database.db, boss);
  const fetched = await boss.fetch<{ operationId: string }>(demoQueue, { batchSize: 10 });
  expect(fetched.some((job) => job.data.operationId === id)).toBe(true);
  // The first queue client disappears with active transport work and no integration lease.
  await boss.stop();
  await systemClock.sleep(options.leaseMs + 10);
  const restarted = await startWorker(database.connectionString, options);
  try {
    await until(async () => (await run(id))?.status === "succeeded");
  } finally {
    await restarted.stop();
  }
  boss = createQueueClient(database.connectionString);
  await boss.start();
  expect(
    await database.db
      .select()
      .from(effectDeduplications)
      .where(eq(effectDeduplications.operationId, id)),
  ).toHaveLength(1);
});

it("recovers an interrupted in-flight job when the independent worker restarts", async () => {
  const id = await intent();
  const first = await startWorker(database.connectionString, {
    ...options,
    delayMs: 500,
    deadlineMs: 1000,
    leaseMs: 1200,
  });
  await until(async () => (await run(id))?.status === "running");
  await first.stop();
  expect((await run(id))?.status).toBe("running");
  const restarted = await startWorker(database.connectionString, options);
  try {
    await until(async () => (await run(id))?.status === "succeeded");
  } finally {
    await restarted.stop();
  }
  expect((await run(id))?.attempts).toBe(2);
});

it("rejects stale responses and cancellation while the provider is running", async () => {
  const staleId = await intent();
  const processing = processOperation(database.db, staleId, {
    ...options,
    delayMs: 100,
    deadlineMs: 1000,
    leaseMs: 1200,
  });
  await until(async () => (await run(staleId))?.status === "running");
  await database.db
    .update(applications)
    .set({ revision: 2 })
    .where(eq(applications.id, seedIds.applicationSmall));
  await processing;
  expect(await run(staleId)).toMatchObject({ status: "cancelled", stale: true, result: null });
  expect(
    await database.db
      .select()
      .from(effectDeduplications)
      .where(eq(effectDeduplications.operationId, staleId)),
  ).toHaveLength(0);
  const cancelId = await intent();
  const cancelling = processOperation(database.db, cancelId, {
    ...options,
    delayMs: 100,
    deadlineMs: 1000,
    leaseMs: 1200,
  });
  await until(async () => (await run(cancelId))?.status === "running");
  await database.db
    .update(applications)
    .set({ status: "withdrawn" })
    .where(eq(applications.id, seedIds.applicationSmall));
  await cancelling;
  expect(await run(cancelId)).toMatchObject({ status: "cancelled", stale: false, result: null });
  await database.db
    .update(applications)
    .set({ status: "draft" })
    .where(eq(applications.id, seedIds.applicationSmall));
});

it("makes missing inputs, transient recovery, terminal failures and exhausted deadlines visible", async () => {
  const missing = await intent("missing_input");
  const transient = await intent("transient_error");
  const exhausted = await intent("transient_error", 1);
  const timeout = await intent("timeout", 2);
  const terminal = await intent("terminal_error");
  const worker = await startWorker(database.connectionString, options);
  try {
    await until(
      async () =>
        (await run(missing))?.status === "waiting_for_input" &&
        (await run(transient))?.status === "succeeded" &&
        (await run(exhausted))?.status === "failed" &&
        (await run(timeout))?.status === "timed_out" &&
        (await run(terminal))?.status === "failed",
    );
    expect((await run(transient))?.attempts).toBe(2);
    expect((await run(timeout))?.attempts).toBe(2);
    expect((await run(terminal))?.attempts).toBe(1);
    expect((await workerHealth(database.pool, 5000)).ready).toBe(true);
  } finally {
    await worker.stop();
  }
  expect((await workerHealth(database.pool, 5000)).ready).toBe(false);
});

it("fences expired claim tokens and exhausts repeatedly crashed attempts", async () => {
  const id = await intent("success", 1);
  const processing = processOperation(database.db, id, {
    ...options,
    delayMs: 100,
    deadlineMs: 1000,
    leaseMs: 50,
  });
  await until(async () => (await run(id))?.status === "running");
  await systemClock.sleep(60);
  await recoverExpiredRuns(database.db);
  await processing;
  expect(await run(id)).toMatchObject({
    status: "failed",
    lastErrorCode: "attempts_exhausted_after_restart",
    attempts: 1,
    result: null,
  });
  expect(
    await database.db
      .select()
      .from(effectDeduplications)
      .where(eq(effectDeduplications.operationId, id)),
  ).toHaveLength(0);
});

it("recovers from SIGKILL of a separate Node worker in the middle of a provider call", async () => {
  const id = await intent();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("./crash-worker.fixture.ts", import.meta.url))],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, TEST_DATABASE_URL: database.connectionString },
    },
  );
  const exited = once(child, "exit");
  try {
    await until(async () => (await run(id))?.status === "running");
    child.kill("SIGKILL");
    await exited;
    expect((await run(id))?.status).toBe("running");
    await systemClock.sleep(210);
    expect((await workerHealth(database.pool, 200)).ready).toBe(false);
    const replacement = await startWorker(database.connectionString, options);
    try {
      await until(async () => (await run(id))?.status === "succeeded");
    } finally {
      await replacement.stop();
    }
    expect((await run(id))?.attempts).toBe(2);
    expect(
      await database.db
        .select()
        .from(effectDeduplications)
        .where(eq(effectDeduplications.operationId, id)),
    ).toHaveLength(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}, 10_000);
