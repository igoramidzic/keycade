import { createDatabase } from "@keycade/db";
import { assertWorkerSchemaReady } from "@keycade/db/cloudflare";
import {
  createDemoInboxCipher,
  createDocumentsService,
  createIdentifierCipher,
} from "@keycade/domain";
import {
  dispatchAccessDeliveries,
  processAccessDelivery,
} from "@keycade/integrations/access-delivery";
import { processCheckJobs } from "@keycade/integrations/check-jobs";
import { createDemoInboxAdapter } from "@keycade/integrations/demo-inbox";
import { processDocumentInterpretations } from "@keycade/integrations/document-processing";
import { processDocumentScans } from "@keycade/integrations/document-scan";
import { createR2DocumentStorage } from "@keycade/integrations/document-storage-r2";
import { processEnrichmentJobs } from "@keycade/integrations/enrichment-jobs";
import {
  dispatchNotifications,
  scheduleApplicationReminders,
} from "@keycade/integrations/notification-jobs";
import {
  deliverOutbox,
  processOperation,
  recoverExpiredRuns,
} from "@keycade/integrations/operations";
import { processSignatureJobs } from "@keycade/integrations/signatures-jobs";

const providerFamilies = [
  "document_scans",
  "document_processing",
  "enrichment",
  "checks",
  "signatures",
] as const;
const scheduledFamilies = [...providerFamilies, "reminders", "cleanup"] as const;
type Family = (typeof scheduledFamilies)[number];
type JobMessage =
  | { operationId: string }
  | { deliveryRequestId: string }
  | { kind: "maintenance" }
  | { kind: "family"; family: Family };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function options(env: JobsBindings) {
  const delayMs = Number(env.SIMULATION_DELAY_MS);
  const deadlineMs = Number(env.PROVIDER_DEADLINE_MS);
  if (
    !Number.isInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 60_000 ||
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 60_000
  )
    throw new Error("Invalid simulation timing.");
  if (env.DEMO_INBOX_ENABLED === "true" && !/^[a-f0-9]{64}$/.test(env.ENCRYPTION_KEY ?? ""))
    throw new Error("Demo encryption is unavailable.");
  return { delayMs, deadlineMs };
}

/** Dispatch never waits for a simulated provider. Access messages enter the queue first. */
async function dispatch(db: ReturnType<typeof createDatabase>["db"], env: JobsBindings) {
  const config = options(env);
  if (env.DEMO_INBOX_ENABLED === "true") {
    await dispatchNotifications(db, { borrowerOrigin: env.BORROWER_ORIGIN });
    await dispatchAccessDeliveries(db, (message) => env.JOBS_QUEUE.send(message));
  }
  await recoverExpiredRuns(db, undefined, config.deadlineMs + 1000);
  await deliverOutbox(db, (message) => env.JOBS_QUEUE.send(message));
}
async function enqueueFamilies(env: JobsBindings, scheduled = false) {
  for (const family of scheduled ? scheduledFamilies : providerFamilies) {
    if (["document_scans", "document_processing", "cleanup"].includes(family) && !env.DOCUMENTS)
      continue;
    if (["enrichment", "checks"].includes(family) && !env.ENCRYPTION_KEY) continue;
    if (family === "reminders" && env.DEMO_INBOX_ENABLED !== "true") continue;
    await env.JOBS_QUEUE.send({ kind: "family", family } satisfies JobMessage);
  }
}
/** One bounded family per consumer invocation (max_batch_size=1).
 * Five 60-second provider deadlines fit comfortably below the 15-minute platform limit.
 * Leases and database intents preserve unfinished work across aborts or duplicate wakes. */
async function processFamily(
  db: ReturnType<typeof createDatabase>["db"],
  env: JobsBindings,
  family: Family,
) {
  const config = { ...options(env), signal: AbortSignal.timeout(6 * 60_000) };
  if (family === "document_scans" && env.DOCUMENTS) {
    const storage = createR2DocumentStorage(env.DOCUMENTS, (size) => new FixedLengthStream(size));
    let scanned = 0;
    while (
      scanned < 5 &&
      !config.signal.aborted &&
      (await processDocumentScans(db, storage, config))
    )
      scanned++;
    if (scanned > 0)
      await env.JOBS_QUEUE.send({
        kind: "family",
        family: "document_processing",
      } satisfies JobMessage);
  } else if (family === "document_processing") await processDocumentInterpretations(db, config);
  else if (family === "enrichment" && env.ENCRYPTION_KEY)
    await processEnrichmentJobs(db, createIdentifierCipher(env.ENCRYPTION_KEY), config);
  else if (family === "checks" && env.ENCRYPTION_KEY)
    await processCheckJobs(db, createIdentifierCipher(env.ENCRYPTION_KEY), config);
  else if (family === "signatures") {
    await processSignatureJobs(db, config);
    await dispatch(db, env);
  } else if (family === "reminders" && env.DEMO_INBOX_ENABLED === "true") {
    await scheduleApplicationReminders(db, {
      firstDelayMs: Number(env.REMINDER_FIRST_DELAY_MS),
      secondDelayMs: Number(env.REMINDER_SECOND_DELAY_MS),
    });
    await dispatch(db, env);
  } else if (family === "cleanup" && env.DOCUMENTS) {
    const storage = createR2DocumentStorage(env.DOCUMENTS, (size) => new FixedLengthStream(size));
    const abandoned = await createDocumentsService(db).cleanupAbandoned();
    for (const upload of abandoned) await storage.remove(upload.storageKey);
    // One page per Cron tick bounds cleanup; old first-page entries disappear before later pages.
    const page = await env.DOCUMENTS.list({ prefix: "staging-", limit: 100 });
    const before = new Date(Date.now() - 2 * 60 * 60_000);
    const expired = page.objects
      .filter((object) => object.uploaded < before)
      .map((object) => object.key);
    if (expired.length) await env.DOCUMENTS.delete(expired);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "POST" && new URL(request.url).pathname === "/internal/dispatch") {
      // This Worker has no public route. Only a service binding can wake its durable queue.
      await env.JOBS_QUEUE.send({ kind: "maintenance" });
      return new Response(null, { status: 202 });
    }
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
        const operationId =
          typeof body === "object" &&
          body !== null &&
          "operationId" in body &&
          typeof body.operationId === "string" &&
          uuid.test(body.operationId)
            ? body.operationId
            : null;
        const deliveryRequestId =
          typeof body === "object" &&
          body !== null &&
          "deliveryRequestId" in body &&
          typeof body.deliveryRequestId === "string" &&
          uuid.test(body.deliveryRequestId)
            ? body.deliveryRequestId
            : null;
        const maintenance =
          typeof body === "object" &&
          body !== null &&
          "kind" in body &&
          body.kind === "maintenance";
        const family =
          typeof body === "object" &&
          body !== null &&
          "kind" in body &&
          body.kind === "family" &&
          "family" in body &&
          typeof body.family === "string" &&
          scheduledFamilies.some((family) => family === body.family)
            ? (body.family as Family)
            : null;
        if (
          [!!operationId, !!deliveryRequestId, maintenance, !!family].filter(Boolean).length !== 1
        ) {
          // No raw payload logs. Invalid messages cannot represent an operation.
          console.warn("Invalid operation message discarded.");
          message.ack();
          continue;
        }
        try {
          if (operationId) await processOperation(db, operationId, config);
          else if (maintenance) {
            await dispatch(db, env);
            await enqueueFamilies(env);
          } else if (family) await processFamily(db, env, family);
          else if (deliveryRequestId && env.DEMO_INBOX_ENABLED === "true") {
            await processAccessDelivery(
              db,
              deliveryRequestId,
              createDemoInboxAdapter(db, { cipher: createDemoInboxCipher(env.ENCRYPTION_KEY) }),
              { delayMs: Math.min(config.delayMs, 1000) },
            );
          } else throw new Error("Demo delivery is unavailable.");
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
      await dispatch(db, env);
      await enqueueFamilies(env, true);
    } catch {
      console.warn("Job dispatch failed; durable outbox retained for recovery.");
      throw new Error("Job dispatch failed.");
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<JobsBindings, JobMessage>;
