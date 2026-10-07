import { createDatabase } from "@keycade/db";
import { assertWorkerSchemaReady } from "@keycade/db/cloudflare";
import {
  deliverOutbox,
  processOperation,
  recoverExpiredRuns,
} from "@keycade/integrations/operations";

interface OperationMessage {
  operationId: string;
}

function options(env: JobsBindings) {
  const delayMs = Number(env.SIMULATION_DELAY_MS);
  const deadlineMs = Number(env.PROVIDER_DEADLINE_MS);
  if (
    !Number.isInteger(delayMs) ||
    delayMs < 0 ||
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 60_000
  )
    throw new Error("Invalid simulation timing.");
  return { delayMs, deadlineMs };
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" || new URL(request.url).pathname !== "/internal/ready")
      return new Response(null, { status: 404 });
    const { pool } = createDatabase(env.HYPERDRIVE.connectionString, { max: 1 });
    try {
      options(env);
      await assertWorkerSchemaReady(pool);
      if (!env.JOBS_QUEUE) throw new Error("Queue binding missing.");
      return Response.json(
        { status: "ready", simulation: true },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return Response.json({ status: "not_ready", simulation: true }, { status: 503 });
    } finally {
      await pool.end();
    }
  },
  async queue(batch, env) {
    const { db, pool } = createDatabase(env.HYPERDRIVE.connectionString, { max: 1 });
    try {
      const config = options(env);
      for (const message of batch.messages) {
        const body: unknown = message.body;
        if (
          typeof body !== "object" ||
          body === null ||
          !("operationId" in body) ||
          typeof body.operationId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operationId)
        ) {
          // No raw payload logs. Invalid messages cannot represent an operation.
          console.warn("Invalid operation message discarded.");
          message.ack();
          continue;
        }
        try {
          await processOperation(db, body.operationId, config);
          // Retries and lease recovery are durable outbox work, picked up by Cron.
          message.ack();
        } catch {
          console.warn("Operation delivery failed; retry scheduled.");
          message.retry({ delaySeconds: 10 });
        }
      }
    } finally {
      await pool.end();
    }
  },
  async scheduled(_event, env) {
    const { db, pool } = createDatabase(env.HYPERDRIVE.connectionString, { max: 1 });
    try {
      const config = options(env);
      await recoverExpiredRuns(db, undefined, config.deadlineMs + 1000);
      await deliverOutbox(db, (message) => env.JOBS_QUEUE.send(message));
    } catch {
      console.warn("Job dispatch failed; durable outbox retained for recovery.");
      throw new Error("Job dispatch failed.");
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<JobsBindings, OperationMessage>;
