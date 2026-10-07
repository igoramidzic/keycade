import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applicationParticipants,
  applications,
  applicationTasks,
  auditEvents,
  documentCategoryOverrides,
  documentProcessingOutbox,
  documentProcessingRuns,
  documents,
  documentVersions,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { type Actor, createDocumentsService, enqueueDocumentProcessing } from "@keycade/domain";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { documentDigest } from "./document-content.js";
import { syntheticDocumentPdf } from "./document-fixtures.js";
import { processDocumentInterpretations } from "./document-processing.js";
import { processDocumentScans } from "./document-scan.js";
import { createLocalDocumentStorage } from "./document-storage-local.js";
import { type Clock } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let directory: string;
let now = new Date("2026-10-07T12:00:00Z");
const clock: Clock = {
  now: () => now,
  sleep: (ms, signal) =>
    ms === 0
      ? Promise.resolve()
      : new Promise((_resolve, reject) => {
          if (signal?.aborted) reject(new Error("aborted"));
          else
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
};
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const denied = { code: "NOT_FOUND", statusCode: 404 };
const service = () => createDocumentsService(database.db, { clock: () => now, scanDelayMs: 0 });
const options = { clock, delayMs: 0, deadlineMs: 60_000, retryBaseMs: 100 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  directory = await mkdtemp(join(tmpdir(), "keycade-processing-"));
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function upload(
  scenario = "clean-tax",
  extra: Record<string, unknown> = {},
  actor: Actor = borrower,
) {
  const bytes = syntheticDocumentPdf(scenario);
  const reservation = await service().beginUpload(
    actor,
    ids.bankA,
    ids.applicationSmall,
    {
      fileName: "arbitrary-name.pdf",
      mimeType: "application/pdf",
      expectedSize: bytes.length,
      idempotencyKey: randomUUID(),
      ...extra,
    },
    randomUUID(),
  );
  const storage = createLocalDocumentStorage(directory);
  const result = await storage.write(
    reservation.storageKey,
    (async function* () {
      yield bytes;
    })(),
    { mimeType: "application/pdf", expectedSize: bytes.length, maxFileBytes: 25 * 1024 * 1024 },
  );
  await service().finalizeUpload(
    actor,
    ids.bankA,
    ids.applicationSmall,
    reservation.uploadId,
    { size: result.size, sha256: result.sha256 },
    randomUUID(),
  );
  return reservation;
}
async function scan() {
  return processDocumentScans(database.db, createLocalDocumentStorage(directory), {
    clock,
    delayMs: 0,
  });
}
async function latest(versionId: string) {
  return (
    await database.db
      .select()
      .from(documentProcessingRuns)
      .where(eq(documentProcessingRuns.versionId, versionId))
      .orderBy(desc(documentProcessingRuns.generation))
  )[0];
}
async function documentView(documentId: string, actor: Actor = borrower) {
  const view = (await service().list(actor, ids.bankA, ids.applicationSmall)).documents.find(
    (x) => x.id === documentId,
  );
  if (!view) throw new Error("Missing document view.");
  return view;
}
describe("durable document interpretation on PostgreSQL", () => {
  it("commits clean scan and one processing outbox atomically and retains typed tax/statement suggestions", async () => {
    for (const [scenario, category] of [
      ["clean-tax", "tax"],
      ["clean-statement", "bank_statement"],
    ] as const) {
      const doc = await upload(scenario);
      expect(await latest(doc.versionId)).toBeUndefined();
      await scan();
      const run = await latest(doc.versionId);
      expect(run?.state).toBe("queued");
      expect(
        await database.db
          .select()
          .from(documentProcessingOutbox)
          .where(eq(documentProcessingOutbox.runId, run?.id ?? randomUUID())),
      ).toHaveLength(1);
      await processDocumentInterpretations(database.db, options);
      const view = await documentView(doc.documentId);
      expect(view).toMatchObject({ category, processingState: "classified" });
      expect(view.versions[0]?.processing).toMatchObject({
        category,
        simulated: true,
        canRetry: false,
      });
      expect(view.versions[0]?.processing?.extractedFields.length).toBeGreaterThan(0);
      expect(
        (await service().download(borrower, ids.bankA, ids.applicationSmall, doc.versionId)).sha256,
      ).toBe(documentDigest(syntheticDocumentPdf(scenario)));
    }
    const [app] = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, ids.applicationSmall));
    expect(app?.requestedAmount).toBe("10000.00");
  });
  it("keeps unknown and low-confidence clean originals available for review", async () => {
    for (const scenario of ["unknown", "low-confidence"]) {
      const doc = await upload(scenario);
      await scan();
      await processDocumentInterpretations(database.db, options);
      const view = await documentView(doc.documentId);
      expect(view.processingState).toBe("needs_review");
      expect(view.versions[0]?.canDownload).toBe(true);
      expect(view.versions[0]?.processing?.confidence).toBeLessThan(0.8);
    }
  });
  it("never enqueues blocked/unscanned inputs and rolls back outbox with the domain transaction", async () => {
    const doc = await upload("blocked");
    await database.db.transaction(async (tx) =>
      expect(
        await enqueueDocumentProcessing(tx, doc.versionId, { now, requestId: randomUUID() }),
      ).toBeNull(),
    );
    await scan();
    expect(await latest(doc.versionId)).toBeUndefined();
    await expect(
      service().retryProcessing(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        doc.versionId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const clean = await upload();
    await database.db
      .update(documentVersions)
      .set({ scanState: "clean" })
      .where(eq(documentVersions.id, clean.versionId));
    await expect(
      database.db.transaction(async (tx) => {
        await enqueueDocumentProcessing(tx, clean.versionId, { now, requestId: randomUUID() });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await latest(clean.versionId)).toBeUndefined();
    await processDocumentInterpretations(database.db, options);
    expect((await latest(clean.versionId))?.state).toBe("classified");
  });
  it("deduplicates repeated enqueue and concurrent dispatch without duplicate documents or task completion", async () => {
    const doc = await upload();
    await scan();
    const before = await database.db.select().from(applicationTasks);
    for (let i = 0; i < 3; i++)
      await database.db.transaction(async (tx) => {
        await tx
          .select()
          .from(applications)
          .where(eq(applications.id, ids.applicationSmall))
          .for("update");
        await enqueueDocumentProcessing(tx, doc.versionId, { now, requestId: randomUUID() });
      });
    await Promise.all([
      processDocumentInterpretations(database.db, options),
      processDocumentInterpretations(database.db, options),
    ]);
    expect(
      await database.db
        .select()
        .from(documentProcessingRuns)
        .where(eq(documentProcessingRuns.versionId, doc.versionId)),
    ).toHaveLength(1);
    expect((await latest(doc.versionId))?.attempts).toBe(1);
    expect(await database.db.select().from(applicationTasks)).toEqual(before);
    expect(
      await database.db.select().from(documents).where(eq(documents.id, doc.documentId)),
    ).toHaveLength(1);
  });
  it("retries transient failure with backoff and exposes terminal failures without losing bytes", async () => {
    const transient = await upload("processing-transient");
    await scan();
    await processDocumentInterpretations(database.db, options);
    expect(await latest(transient.versionId)).toMatchObject({
      state: "queued",
      attempts: 1,
      lastErrorCode: "transient_error",
    });
    expect(await processDocumentInterpretations(database.db, options)).toBe(false);
    now = new Date(now.getTime() + 100);
    await processDocumentInterpretations(database.db, options);
    expect(await latest(transient.versionId)).toMatchObject({
      state: "classified",
      attempts: 2,
      lastErrorCode: null,
    });
    const failed = await upload("processing-error");
    await scan();
    await processDocumentInterpretations(database.db, options);
    expect(await latest(failed.versionId)).toMatchObject({
      state: "failed",
      lastErrorCode: "terminal_error",
    });
    expect((await documentView(failed.documentId)).versions[0]?.processing?.canRetry).toBe(true);
    expect(
      (await service().download(borrower, ids.bankA, ids.applicationSmall, failed.versionId))
        .sha256,
    ).toBeTruthy();
    await service().retryProcessing(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      failed.versionId,
      randomUUID(),
    );
    await service().retryProcessing(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      failed.versionId,
      randomUUID(),
    );
    expect(
      await database.db
        .select()
        .from(documentProcessingRuns)
        .where(eq(documentProcessingRuns.versionId, failed.versionId)),
    ).toHaveLength(2);
    await processDocumentInterpretations(database.db, options);
  });
  it("preserves manual category history and original machine results through reprocessing", async () => {
    const doc = await upload();
    await scan();
    await processDocumentInterpretations(database.db, options);
    const input = {
      versionId: doc.versionId,
      category: "business_legal",
      reason: "Synthetic staff correction",
    };
    await expect(
      service().correctCategory(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        doc.documentId,
        input,
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await service().correctCategory(
      officer,
      ids.bankA,
      ids.applicationSmall,
      doc.documentId,
      input,
      randomUUID(),
    );
    await service().correctCategory(
      officer,
      ids.bankA,
      ids.applicationSmall,
      doc.documentId,
      input,
      randomUUID(),
    );
    expect(
      await database.db
        .select()
        .from(documentCategoryOverrides)
        .where(eq(documentCategoryOverrides.versionId, doc.versionId)),
    ).toHaveLength(1);
    expect((await documentView(doc.documentId)).category).toBe("business_legal");
    await service().retryProcessing(
      officer,
      ids.bankA,
      ids.applicationSmall,
      doc.versionId,
      randomUUID(),
    );
    expect((await documentView(doc.documentId)).category).toBe("business_legal");
    await processDocumentInterpretations(database.db, options);
    const view = await documentView(doc.documentId);
    expect(view.category).toBe("business_legal");
    expect(view.versions[0]?.processing?.category).toBe("tax");
    expect(view.versions[0]?.processing?.history).toHaveLength(2);
    expect(
      view.versions[0]?.processing?.history.every((run) => run.result?.category === "tax"),
    ).toBe(true);
  });
  it("retains in-flight stale history but cannot apply it to a replacement", async () => {
    const doc = await upload();
    await scan();
    let release: (() => void) | undefined;
    let started = false;
    const held: Clock = {
      now: () => now,
      sleep: (ms, signal) =>
        ms === 10
          ? new Promise<void>((resolve) => {
              started = true;
              release = resolve;
            })
          : clock.sleep(ms, signal),
    };
    const pending = processDocumentInterpretations(database.db, {
      ...options,
      clock: held,
      delayMs: 10,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    const next = await upload("clean-statement", { replacesDocumentId: doc.documentId });
    release?.();
    await pending;
    expect(await latest(doc.versionId)).toMatchObject({
      stale: true,
      state: "classified",
      result: { category: "tax" },
    });
    const view = await documentView(doc.documentId);
    expect(view).toMatchObject({
      currentVersionId: next.versionId,
      category: "other",
      processingState: null,
    });
    await expect(
      service().correctCategory(
        officer,
        ids.bankA,
        ids.applicationSmall,
        doc.documentId,
        { versionId: doc.versionId, category: "tax", reason: "Old version" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await scan();
    await processDocumentInterpretations(database.db, options);
    expect((await documentView(doc.documentId)).category).toBe("bank_statement");
  });
  it("persists a deadline failure with an injected clock and a bounded attempt limit", async () => {
    const doc = await upload("processing-timeout");
    await scan();
    const run = await latest(doc.versionId);
    if (!run) throw new Error("missing run");
    await database.db
      .update(documentProcessingRuns)
      .set({ maxAttempts: 1 })
      .where(eq(documentProcessingRuns.id, run.id));
    const timeoutClock: Clock = {
      now: () => now,
      sleep: (ms, signal) => {
        if (ms === 10) {
          now = new Date(now.getTime() + 10);
          return Promise.resolve();
        }
        return clock.sleep(ms, signal);
      },
    };
    await processDocumentInterpretations(database.db, {
      ...options,
      clock: timeoutClock,
      deadlineMs: 10,
    });
    expect(await latest(doc.versionId)).toMatchObject({
      state: "failed",
      attempts: 1,
      lastErrorCode: "deadline_exceeded",
    });
    expect((await documentView(doc.documentId)).versions[0]?.canDownload).toBe(true);
  });
  it("recovers an expired processing lease and does not accept an obsolete claim token", async () => {
    const doc = await upload();
    await scan();
    const run = await latest(doc.versionId);
    if (!run) throw new Error("missing run");
    await database.db
      .update(documentProcessingRuns)
      .set({
        state: "processing",
        attempts: 1,
        claimToken: randomUUID(),
        leaseUntil: new Date(now.getTime() - 1),
      })
      .where(eq(documentProcessingRuns.id, run.id));
    await processDocumentInterpretations(database.db, options);
    expect(await latest(doc.versionId)).toMatchObject({
      state: "classified",
      attempts: 2,
      claimToken: null,
    });
  });
  it("ignores a late worker result after its lease was reclaimed", async () => {
    const doc = await upload();
    await scan();
    let release: (() => void) | undefined;
    let started = false;
    const held: Clock = {
      now: () => now,
      sleep: (ms, signal) =>
        ms === 10
          ? new Promise<void>((resolve) => {
              started = true;
              release = resolve;
            })
          : clock.sleep(ms, signal),
    };
    const old = processDocumentInterpretations(database.db, {
      ...options,
      clock: held,
      delayMs: 10,
    });
    await vi.waitFor(() => expect(started).toBe(true));
    now = new Date(now.getTime() + options.deadlineMs + 30_001);
    await processDocumentInterpretations(database.db, options);
    const before = await latest(doc.versionId);
    expect(before).toMatchObject({ state: "classified", attempts: 2 });
    release?.();
    await old;
    expect(await latest(doc.versionId)).toEqual(before);
    const effects = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetId, doc.versionId), eq(auditEvents.action, "document.processed")),
      );
    expect(effects).toHaveLength(1);
  });
  it("never broadens private visibility, category counts or suggested task titles", async () => {
    const userId = randomUUID(),
      participantId = randomUUID(),
      taskId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `private-${userId}@example.test`,
      displayName: "Synthetic private owner",
      synthetic: true,
    });
    await database.db.insert(applicationParticipants).values({
      id: participantId,
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      userId,
      role: "owner",
      scope: "assigned",
      synthetic: true,
    });
    await database.db.insert(applicationTasks).values({
      id: taskId,
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      stableKey: `private:${taskId}`,
      source: "manual",
      title: "Private synthetic tax evidence",
      description: "Synthetic private task",
      reason: "Synthetic fixture",
      stage: "approval",
      required: true,
      visibility: "private",
      subjectUserId: userId,
      assigneeParticipantId: participantId,
      inputRevision: 1,
    });
    const owner: Actor = { kind: "user", userId };
    const doc = await upload("clean-tax", { taskId }, owner);
    await scan();
    await processDocumentInterpretations(database.db, options);
    const view = await documentView(doc.documentId, owner);
    expect(view.category).toBe("tax");
    expect(view.versions[0]?.processing?.suggestedTasks).toEqual([
      { id: taskId, title: "Private synthetic tax evidence" },
    ]);
    expect(
      (await service().list(borrower, ids.bankA, ids.applicationSmall)).documents.some(
        (x) => x.id === doc.documentId,
      ),
    ).toBe(false);
    await expect(
      service().retryProcessing(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        doc.versionId,
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, participantId));
    await expect(service().list(owner, ids.bankA, ids.applicationSmall)).rejects.toMatchObject(
      denied,
    );
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, doc.versionId));
    expect(JSON.stringify(events)).not.toContain("gross_receipts");
  });
});
