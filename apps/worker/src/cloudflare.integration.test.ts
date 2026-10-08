import { createHash, randomUUID } from "node:crypto";
import {
  applicationTasks,
  auditEvents,
  checkRuns,
  documentProcessingRuns,
  documentVersions,
  enrichmentRuns,
} from "@keycade/db";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  createChecksService,
  createDemoInboxCipher,
  createDemoInboxService,
  createDocumentsService,
  createEnrichmentService,
  createIdentifierCipher,
  createIdentityService,
  createTasksService,
} from "@keycade/domain";
import { enqueueDemo } from "@keycade/integrations";
import { and, eq, inArray } from "drizzle-orm";
import { expect, test } from "vitest";
import { createDemoImportPdf } from "../../../packages/contracts/src/demo-import";
import worker from "../worker";

test("native document families drain a full batch after an early processing wake without Cron or duplicate effects", async () => {
  const database = await createTestDatabase();
  const emitted: unknown[] = [];
  const objects = new Map<string, Uint8Array>();
  const env = {
    HYPERDRIVE: { connectionString: database.connectionString },
    JOBS_QUEUE: {
      send: async (message: unknown) => {
        emitted.push(message);
      },
    },
    DOCUMENTS: {
      get: async (key: string) => {
        const bytes = objects.get(key);
        if (!bytes) return null;
        return {
          size: bytes.length,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      },
    },
    SIMULATION_DELAY_MS: "0",
    PROVIDER_DEADLINE_MS: "1000",
  } as unknown as JobsBindings;
  const deliver = async (body: unknown) => {
    let ack = false,
      retry = false;
    await worker.queue(
      {
        messages: [
          {
            body,
            ack: () => {
              ack = true;
            },
            retry: () => {
              retry = true;
            },
          },
        ],
      } as unknown as Parameters<typeof worker.queue>[0],
      env,
    );
    expect({ ack, retry }).toEqual({ ack: true, retry: false });
  };
  const scan = { kind: "family", family: "document_scans" };
  const processing = { kind: "family", family: "document_processing" };
  try {
    await seedDatabase(database.connectionString);
    const borrower = { kind: "user" as const, userId: seedIds.borrower };
    const service = createDocumentsService(database.db, { scanDelayMs: 0 });
    const context = (await service.list(borrower, seedIds.bankA, seedIds.applicationSmall))
      .demoImportContext;
    if (!context) throw new Error("Expected a synthetic import context.");
    const bytes = createDemoImportPdf("business-tax-return-2023", context);
    const versions: string[] = [];
    // Ten documents exercise both five-item invocation budgets. An eleventh future scan
    // verifies that continuing a full batch does not spin on work that is not due yet.
    for (let index = 0; index < 11; index++) {
      const upload = await service.beginUpload(
        borrower,
        seedIds.bankA,
        seedIds.applicationSmall,
        {
          idempotencyKey: randomUUID(),
          fileName: `synthetic-batch-${index}.pdf`,
          mimeType: "application/pdf",
          expectedSize: bytes.length,
          demoImport: {
            fileName: "business-tax-return-2023.txt",
            text: "Synthetic batch scheduling fixture.",
            context,
          },
        },
        randomUUID(),
      );
      objects.set(upload.storageKey, bytes);
      await service.finalizeUpload(
        borrower,
        seedIds.bankA,
        seedIds.applicationSmall,
        upload.uploadId,
        { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
        randomUUID(),
      );
      versions.push(upload.versionId);
    }
    const later = new Date(Date.now() + 60 * 60_000);
    await database.db
      .update(documentVersions)
      .set({ scanAvailableAt: later })
      .where(eq(documentVersions.id, versions[10]!));

    // A maintenance wake may deliver interpretation before scans have created any intent.
    await deliver(processing);
    expect(emitted).toEqual([]);
    expect(await database.db.select().from(documentProcessingRuns)).toEqual([]);
    await deliver(scan);
    const attemptedMessages: unknown[] = [];
    while (emitted.length) {
      expect(attemptedMessages.length).toBeLessThan(12);
      const message = emitted.shift();
      attemptedMessages.push(message);
      await deliver(message);
    }
    const readyVersions = versions.slice(0, 10);
    const runs = await database.db
      .select()
      .from(documentProcessingRuns)
      .where(inArray(documentProcessingRuns.versionId, readyVersions));
    expect(runs).toHaveLength(10);
    for (const run of runs) {
      expect(run).toMatchObject({ state: "classified", stale: false, attempts: 1 });
      expect(run.result).toMatchObject({ simulated: true, versionId: run.versionId });
    }
    const scanned = await database.db
      .select()
      .from(documentVersions)
      .where(inArray(documentVersions.id, readyVersions));
    expect(
      scanned.every((version) => version.scanState === "clean" && version.scanAttempts === 1),
    ).toBe(true);
    const effects = () =>
      database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            inArray(auditEvents.targetId, readyVersions),
            inArray(auditEvents.action, ["document.scanned", "document.processed"]),
          ),
        );
    expect(await effects()).toHaveLength(20);
    for (const message of [scan, processing, ...attemptedMessages]) await deliver(message);
    expect(emitted).toEqual([]);
    expect(await effects()).toHaveLength(20);
    expect(
      await database.db
        .select()
        .from(documentProcessingRuns)
        .where(inArray(documentProcessingRuns.versionId, readyVersions)),
    ).toEqual(runs);
    expect(
      (
        await database.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.id, versions[10]!))
      )[0],
    ).toMatchObject({ scanState: "pending", scanAttempts: 0 });

    // A delayed retry is likewise left to its durable availability time, without queue churn.
    await service.retryProcessing(
      { kind: "user", userId: seedIds.officerA },
      seedIds.bankA,
      seedIds.applicationSmall,
      readyVersions[0]!,
      randomUUID(),
    );
    await database.db
      .update(documentProcessingRuns)
      .set({ availableAt: later })
      .where(eq(documentProcessingRuns.state, "queued"));
    await deliver(processing);
    expect(emitted).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(documentProcessingRuns)
          .where(eq(documentProcessingRuns.state, "queued"))
      )[0],
    ).toMatchObject({ attempts: 0, availableAt: later });
  } finally {
    await database.cleanup();
  }
});

test("private service wake and native queue deliver a single encrypted demo message without SMTP", async () => {
  const database = await createTestDatabase();
  const delivered: unknown[] = [];
  const key = "27".repeat(32);
  const env = {
    HYPERDRIVE: { connectionString: database.connectionString },
    JOBS_QUEUE: {
      send: async (message: unknown) => {
        delivered.push(message);
      },
    },
    SIMULATION_DELAY_MS: "0",
    PROVIDER_DEADLINE_MS: "1000",
    DEMO_INBOX_ENABLED: "true",
    ENCRYPTION_KEY: key,
    BORROWER_ORIGIN: "https://synthetic-borrower.example.test",
    REMINDER_FIRST_DELAY_MS: "86400000",
    REMINDER_SECOND_DELAY_MS: "259200000",
  } as unknown as JobsBindings;
  const deliver = async (body: unknown) => {
    let ack = false,
      retry = false;
    await worker.queue(
      {
        messages: [
          {
            body,
            ack: () => {
              ack = true;
            },
            retry: () => {
              retry = true;
            },
          },
        ],
      } as unknown as Parameters<typeof worker.queue>[0],
      env,
    );
    expect({ ack, retry }).toEqual({ ack: true, retry: false });
  };
  try {
    await seedDatabase(database.connectionString);
    const identity = createIdentityService(database.db);
    const input = {
      email: "native-inbox@example.test",
      bankSlug: "bank-a",
      portal: "borrower" as const,
      returnPath: "/",
      origin: env.BORROWER_ORIGIN,
      requestId: "native-inbox-test",
      rateLimitKey: "native-inbox-test",
    };
    const session = await identity.signInDemo(input);
    await identity.requestAccessLink(input);
    expect(
      (
        await worker.fetch(
          new Request("https://jobs.internal/internal/dispatch", { method: "POST" }),
          env,
        )
      ).status,
    ).toBe(202);
    expect(delivered).toEqual([{ kind: "maintenance" }]);
    await deliver(delivered.shift());
    expect(delivered[0]).toHaveProperty("deliveryRequestId");
    expect(delivered.slice(1)).toEqual([
      { kind: "family", family: "enrichment" },
      { kind: "family", family: "checks" },
      { kind: "family", family: "signatures" },
    ]);
    const body = delivered.shift();
    await deliver(body);
    await deliver(body);
    const inbox = createDemoInboxService(database.db, { cipher: createDemoInboxCipher(key) });
    const messages = await inbox.list(session.session.actor, seedIds.bankA);
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0]?.state).toBe("available");
    expect(
      (await inbox.open(session.session.actor, seedIds.bankA, messages.messages[0]!.id)).text,
    ).toContain("No external email has been sent.");
    expect(
      (
        await database.pool.query(
          "SELECT status,attempts FROM access_delivery_requests WHERE request_id=$1",
          [input.requestId],
        )
      ).rows,
    ).toEqual([{ status: "delivered", attempts: 1 }]);
    delivered.length = 0;
    await worker.scheduled({} as ScheduledController, env);
    expect(delivered).toEqual([
      { kind: "family", family: "enrichment" },
      { kind: "family", family: "checks" },
      { kind: "family", family: "signatures" },
      { kind: "family", family: "reminders" },
    ]);
    expect(
      (await worker.fetch(new Request("https://jobs.internal/internal/dispatch"), env)).status,
    ).toBe(404);
    const invalid = { ...env, ENCRYPTION_KEY: "" } as unknown as JobsBindings;
    expect(
      (await worker.fetch(new Request("https://jobs.internal/internal/ready"), invalid)).status,
    ).toBe(503);
    const disabled = { ...env, DEMO_INBOX_ENABLED: "false" } as unknown as JobsBindings;
    expect(
      (await worker.fetch(new Request("https://jobs.internal/internal/ready"), disabled)).status,
    ).toBe(503);
    expect(
      (await worker.fetch(new Request("https://jobs.internal/internal/ready"), env)).status,
    ).toBe(200);
  } finally {
    await database.cleanup();
  }
});

test("Cron dispatch and queue delivery preserve durable retries and one effect after duplicate delivery", async () => {
  const database = await createTestDatabase();
  const delivered: unknown[] = [];
  const env = {
    HYPERDRIVE: { connectionString: database.connectionString },
    JOBS_QUEUE: {
      send: async (message: unknown) => {
        delivered.push(message);
      },
    },
    SIMULATION_DELAY_MS: "0",
    PROVIDER_DEADLINE_MS: "1000",
  } as unknown as JobsBindings;
  const deliver = async (body: unknown) => {
    let acknowledged = false;
    let retried = false;
    const batch = {
      messages: [
        {
          body,
          ack: () => {
            acknowledged = true;
          },
          retry: () => {
            retried = true;
          },
        },
      ],
    } as unknown as MessageBatch<{ operationId: string }>;
    await worker.queue(batch, env);
    expect(acknowledged).toBe(true);
    expect(retried).toBe(false);
  };
  try {
    await seedDatabase(database.connectionString);
    const operationId = await database.db.transaction((tx) =>
      enqueueDemo(tx, {
        bankId: seedIds.bankA,
        applicationId: seedIds.applicationSmall,
        scenario: "transient_error",
        requestId: "synthetic-cloudflare-adapter-test",
      }),
    );
    await worker.scheduled({} as ScheduledController, env);
    expect(delivered).toEqual([{ operationId }, { kind: "family", family: "signatures" }]);
    await deliver(delivered.shift());
    const retry = await database.pool.query("SELECT status FROM integration_runs WHERE id=$1", [
      operationId,
    ]);
    expect(retry.rows[0].status).toBe("retry_scheduled");
    expect(
      (
        await database.pool.query("SELECT dispatched_at FROM outbox_events WHERE run_id=$1", [
          operationId,
        ])
      ).rows[0].dispatched_at,
    ).toBeNull();
    // The dispatcher uses the runtime clock; PostgreSQL may run a few milliseconds ahead
    // in its VM. Make the retry unambiguously due without depending on either wall clock.
    await database.pool.query("UPDATE integration_runs SET available_at = $2 WHERE id=$1", [
      operationId,
      new Date(0),
    ]);
    delivered.length = 0;
    await worker.scheduled({} as ScheduledController, env);
    expect(delivered).toEqual([{ operationId }, { kind: "family", family: "signatures" }]);
    await deliver(delivered[0]);
    await deliver(delivered[0]);
    expect(
      (await database.pool.query("SELECT status FROM integration_runs WHERE id=$1", [operationId]))
        .rows[0].status,
    ).toBe("succeeded");
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM effect_deduplications WHERE operation_id=$1",
          [operationId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1 AND action='simulation.completed'",
          [operationId],
        )
      ).rows[0].n,
    ).toBe(1);
    await deliver({ operationId: "invalid" });
  } finally {
    await database.cleanup();
  }
});

test("dispatch prioritizes inbox and independently queued provider families preserve timeout retries", async () => {
  const database = await createTestDatabase();
  const delivered: unknown[] = [];
  const key = "36".repeat(32);
  const env = {
    HYPERDRIVE: { connectionString: database.connectionString },
    JOBS_QUEUE: {
      send: async (message: unknown) => {
        delivered.push(message);
      },
    },
    SIMULATION_DELAY_MS: "0",
    PROVIDER_DEADLINE_MS: "20",
    DEMO_INBOX_ENABLED: "true",
    ENCRYPTION_KEY: key,
    BORROWER_ORIGIN: "https://synthetic-borrower.example.test",
    REMINDER_FIRST_DELAY_MS: "86400000",
    REMINDER_SECOND_DELAY_MS: "259200000",
  } as unknown as JobsBindings;
  const deliver = async (body: unknown) => {
    let ack = false,
      retry = false;
    await worker.queue(
      {
        messages: [
          {
            body,
            ack: () => {
              ack = true;
            },
            retry: () => {
              retry = true;
            },
          },
        ],
      } as unknown as Parameters<typeof worker.queue>[0],
      env,
    );
    expect({ ack, retry }).toEqual({ ack: true, retry: false });
  };
  try {
    await seedDatabase(database.connectionString);
    const actor = { kind: "user" as const, userId: seedIds.borrower };
    const task = (
      await createTasksService(database.db).read(actor, seedIds.bankA, seedIds.applicationSmall)
    ).tasks.find((t) => t.inputKind === "synthetic_business_identifier")!;
    const checks = createChecksService(database.db, { cipher: createIdentifierCipher(key) });
    await checks.captureIdentifier(
      actor,
      seedIds.bankA,
      seedIds.applicationSmall,
      task.id,
      {
        expectedRevision: task.revision,
        expectedInputRevision: task.secureInput!.revision,
        value: "000000005",
      },
      randomUUID(),
    );
    await createEnrichmentService(database.db, { cipher: createIdentifierCipher(key) }).requestRun(
      actor,
      seedIds.bankA,
      seedIds.applicationSmall,
      { expectedRevision: 1, kind: "business" },
      randomUUID(),
    );
    const identity = createIdentityService(database.db);
    const input = {
      email: "native-priority@example.test",
      bankSlug: "bank-a",
      portal: "borrower" as const,
      returnPath: "/",
      origin: env.BORROWER_ORIGIN,
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    };
    const session = await identity.signInDemo(input);
    await identity.requestAccessLink(input);
    await worker.scheduled({} as ScheduledController, env);
    // Scheduling performs no delayed provider work, even with registered timeout inputs pending.
    expect(delivered[0]).toHaveProperty("deliveryRequestId");
    const pending = await database.db
      .select()
      .from(enrichmentRuns)
      .where(eq(enrichmentRuns.applicationId, seedIds.applicationSmall));
    expect(pending.some((r) => r.status === "queued" && r.attempts === 0)).toBe(true);
    expect(delivered).toEqual(
      expect.arrayContaining([
        { kind: "family", family: "enrichment" },
        { kind: "family", family: "checks" },
        { kind: "family", family: "signatures" },
        { kind: "family", family: "reminders" },
      ]),
    );
    await deliver(delivered[0]);
    const inbox = createDemoInboxService(database.db, { cipher: createDemoInboxCipher(key) });
    expect((await inbox.list(session.session.actor, seedIds.bankA)).messages).toHaveLength(1);
    await deliver({ kind: "family", family: "enrichment" });
    expect(
      (
        await database.db
          .select()
          .from(enrichmentRuns)
          .where(eq(enrichmentRuns.applicationId, seedIds.applicationSmall))
      ).some((r) => r.status === "retry_scheduled" && r.errorCode === "deadline_exceeded"),
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(checkRuns)
          .where(eq(checkRuns.applicationId, seedIds.applicationSmall))
      ).some((r) => r.status === "queued" && r.attempts === 0),
    ).toBe(true);
    await deliver({ kind: "family", family: "checks" });
    expect(
      (
        await database.db
          .select()
          .from(checkRuns)
          .where(eq(checkRuns.applicationId, seedIds.applicationSmall))
      ).some((r) => r.status === "retry_scheduled" && r.errorCode === "deadline_exceeded"),
    ).toBe(true);
    expect((await inbox.list(session.session.actor, seedIds.bankA)).messages).toHaveLength(1);
    await deliver({ kind: "family", family: "unknown" });
    await deliver({ kind: "family", family: "checks", operationId: randomUUID() });
  } finally {
    await database.cleanup();
  }
});
