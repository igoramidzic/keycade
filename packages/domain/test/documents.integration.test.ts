import { randomUUID } from "node:crypto";
import {
  applicationParticipants,
  applications,
  applicationTasks,
  auditEvents,
  businessRelationships,
  documents,
  documentVersions,
  taskDocumentEvidence,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createDocumentsService,
  createParticipantsService,
  createTasksService,
  documentResourceScopePolicy,
  requireApplicationAccess,
  requireDocumentAccess,
  validateDocumentGrants,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const adviser: Actor = { kind: "user", userId: ids.adviser };
const denied = { code: "NOT_FOUND", statusCode: 404 };
const content = { size: 100, sha256: "a".repeat(64) };
const now = new Date("2026-10-07T12:00:00Z");
const service = () => createDocumentsService(database.db, { clock: () => now, scanDelayMs: 500 });
const tasks = () => createTasksService(database.db, { clock: () => now });
const payload = (extra: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  fileName: "Synthetic evidence.pdf",
  mimeType: "application/pdf",
  expectedSize: content.size,
  ...extra,
});
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());
async function participant(userId: string) {
  const [row] = await database.db
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.applicationId, ids.applicationSmall),
        eq(applicationParticipants.userId, userId),
      ),
    );
  if (!row) throw new Error("Missing synthetic participant.");
  return row;
}
async function manual(userId: string = ids.borrower, visibility: "shared" | "assigned" = "shared") {
  const before = await tasks().read(officer, ids.bankA, ids.applicationSmall);
  const view = await tasks().createManual(
    officer,
    ids.bankA,
    ids.applicationSmall,
    {
      idempotencyKey: randomUUID(),
      title: `Synthetic evidence ${randomUUID()}`,
      description: "Synthetic upload task",
      assigneeParticipantId: (await participant(userId)).id,
      visibility,
    },
    randomUUID(),
  );
  const task = view.tasks.find((task) => !before.tasks.some((x) => x.id === task.id));
  if (!task) throw new Error("Missing task.");
  return task;
}
async function uploaded(actor: Actor = borrower, extra: Record<string, unknown> = {}) {
  const upload = await service().beginUpload(
    actor,
    ids.bankA,
    ids.applicationSmall,
    payload(extra),
    randomUUID(),
  );
  await service().finalizeUpload(
    actor,
    ids.bankA,
    ids.applicationSmall,
    upload.uploadId,
    content,
    randomUUID(),
  );
  return upload;
}
async function clean(versionId: string) {
  await database.db
    .update(documentVersions)
    .set({ scanState: "clean", scannedAt: now })
    .where(eq(documentVersions.id, versionId));
}
describe("private document lifecycle on PostgreSQL", () => {
  it("reserves, finalizes and retries exactly once with durable delayed scan metadata", async () => {
    const input = payload();
    const one = await service().beginUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    const again = await service().beginUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    expect(again).toEqual(one);
    await expect(
      database.db
        .update(documentVersions)
        .set({ uploadState: "uploaded", uploadedAt: now })
        .where(eq(documentVersions.id, one.versionId)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      service().beginUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        { ...input, expectedSize: 200 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await service().upload(borrower, ids.bankA, ids.applicationSmall, one.uploadId))
        .alreadyFinalized,
    ).toBe(false);
    await expect(
      service().finalizeUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        one.uploadId,
        { ...content, size: 99 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const done = await service().finalizeUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      one.uploadId,
      content,
      randomUUID(),
    );
    expect(done.alreadyFinalized).toBe(true);
    await service().finalizeUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      one.uploadId,
      content,
      randomUUID(),
    );
    await expect(
      service().finalizeUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        one.uploadId,
        { ...content, sha256: "b".repeat(64) },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const versions = await database.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, one.documentId));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      uploadState: "uploaded",
      scanState: "pending",
      scanAttempts: 0,
      scanAvailableAt: new Date(now.getTime() + 500),
      sha256: content.sha256,
    });
    const view = await service().list(borrower, ids.bankA, ids.applicationSmall);
    expect(view.limits).toEqual({
      maxFileBytes: 25 * 1024 * 1024,
      maxBatchFiles: 10,
      allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
    });
    expect(JSON.stringify(view)).not.toContain("storageKey");
    expect(JSON.stringify(view)).not.toContain("keyHash");
  });
  it("enforces MIME, size, path and active setup limits before allocating a reservation", async () => {
    for (const input of [
      payload({ fileName: "../evidence.pdf" }),
      payload({ fileName: "C:\\evidence.pdf" }),
      payload({ fileName: "evidence\n.pdf" }),
      payload({ mimeType: "text/html" }),
      payload({ expectedSize: 0 }),
    ]) {
      await expect(
        service().beginUpload(borrower, ids.bankA, ids.applicationSmall, input, randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(
      createDocumentsService(database.db, { maxFileBytes: 99 }).beginUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        payload(),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ statusCode: 413 });
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: ids.applicationEmpty,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    });
    await expect(
      service().beginUpload(borrower, ids.bankA, ids.applicationEmpty, payload(), randomUUID()),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
  });
  it("rechecks current assignee scope on begin, content authorization, finalization and download", async () => {
    const task = await manual(ids.adviser, "assigned");
    await expect(
      service().beginUpload(adviser, ids.bankA, ids.applicationSmall, payload(), randomUUID()),
    ).rejects.toMatchObject(denied);
    const one = await service().beginUpload(
      adviser,
      ids.bankA,
      ids.applicationSmall,
      payload({ taskId: task.id }),
      randomUUID(),
    );
    expect(
      (await service().list(adviser, ids.bankA, ids.applicationSmall)).documents.map((x) => x.id),
    ).toContain(one.documentId);
    await expect(
      service().upload(borrower, ids.bankA, ids.applicationSmall, one.uploadId),
    ).rejects.toMatchObject(denied);
    const adviserParticipant = await participant(ids.adviser);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, adviserParticipant.id));
    await expect(
      service().upload(adviser, ids.bankA, ids.applicationSmall, one.uploadId),
    ).rejects.toMatchObject(denied);
    await expect(
      service().finalizeUpload(
        adviser,
        ids.bankA,
        ids.applicationSmall,
        one.uploadId,
        content,
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, adviserParticipant.id));
    await service().finalizeUpload(
      adviser,
      ids.bankA,
      ids.applicationSmall,
      one.uploadId,
      content,
      randomUUID(),
    );
    await clean(one.versionId);
    expect(
      (await service().download(adviser, ids.bankA, ids.applicationSmall, one.versionId))
        .storageKey,
    ).toBe(one.storageKey);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, adviserParticipant.id));
    await expect(
      service().download(adviser, ids.bankA, ids.applicationSmall, one.versionId),
    ).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, adviserParticipant.id));
  });
  it("conceals inherited private owner evidence and validates delegated private recipients", async () => {
    const userId = randomUUID();
    const email = `owner-${userId}@example.test`;
    await database.db
      .insert(users)
      .values({ id: userId, email, displayName: "Synthetic owner", synthetic: true });
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      userId,
      role: "owner",
      scope: "assigned",
      synthetic: true,
    });
    await database.db.insert(businessRelationships).values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      businessId: ids.businessA,
      userId,
      displayName: "Synthetic owner",
      kind: "owner",
      ownershipPercent: "30",
      createdByUserId: ids.officerA,
      synthetic: true,
    });
    const actor: Actor = { kind: "user", userId };
    const task = (await tasks().read(actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (x) => x.visibility === "private",
    );
    if (!task) throw new Error("Missing private owner task.");
    const upload = await uploaded(actor, { taskId: task.id });
    await clean(upload.versionId);
    expect(
      (await service().list(actor, ids.bankA, ids.applicationSmall)).documents.find(
        (x) => x.id === upload.documentId,
      ),
    ).toMatchObject({ visibility: "private", subjectUserId: userId });
    expect(
      (await service().list(borrower, ids.bankA, ids.applicationSmall)).documents.find(
        (x) => x.id === upload.documentId,
      ),
    ).toBeUndefined();
    await expect(
      service().download(borrower, ids.bankA, ids.applicationSmall, upload.versionId),
    ).rejects.toMatchObject(denied);
    await expect(
      requireDocumentAccess(
        database.db,
        adviser,
        { bankId: ids.bankA, applicationId: ids.applicationSmall, resourceId: upload.documentId },
        documentResourceScopePolicy(database.db),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      database.db.transaction((tx) =>
        validateDocumentGrants(
          tx,
          officer,
          { kind: "staff", role: "officer" },
          ids.bankA,
          ids.applicationSmall,
          [upload.documentId],
          "borrower@example.test",
        ),
      ),
    ).rejects.toMatchObject(denied);
    await database.db.transaction((tx) =>
      validateDocumentGrants(
        tx,
        officer,
        { kind: "staff", role: "officer" },
        ids.bankA,
        ids.applicationSmall,
        [upload.documentId],
        email,
      ),
    );
    await expect(
      database.db.transaction(async (tx) =>
        validateDocumentGrants(
          tx,
          borrower,
          await requireApplicationAccess(tx, borrower, ids.bankA, ids.applicationSmall),
          ids.bankA,
          ids.applicationSmall,
          [upload.documentId],
          email,
        ),
      ),
    ).rejects.toMatchObject(denied);
  });
  it("rejects cross-bank, cross-application and mismatched task replacements", async () => {
    const task = await manual();
    const upload = await uploaded(borrower, { taskId: task.id });
    const other = await manual();
    await expect(
      service().beginUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        payload({ taskId: other.id, replacesDocumentId: upload.documentId }),
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      service().beginUpload(
        officer,
        ids.bankA,
        ids.applicationLarge,
        payload({ taskId: task.id }),
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      service().download(officer, ids.bankA, ids.applicationLarge, upload.versionId),
    ).rejects.toMatchObject(denied);
    await expect(
      service().download(
        { kind: "user", userId: ids.officerB },
        ids.bankA,
        ids.applicationSmall,
        upload.versionId,
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      database.db.transaction((tx) =>
        validateDocumentGrants(
          tx,
          officer,
          { kind: "staff", role: "officer" },
          ids.bankA,
          ids.applicationLarge,
          [upload.documentId],
        ),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      database.db.insert(taskDocumentEvidence).values({
        bankId: ids.bankA,
        applicationId: ids.applicationLarge,
        taskId: other.id,
        documentId: upload.documentId,
        versionId: upload.versionId,
        evidenceRevision: 1,
        createdByUserId: ids.borrower,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
  it("quarantines pending, blocked and failed scans and preserves attempts on retry", async () => {
    const upload = await uploaded();
    await expect(
      service().download(borrower, ids.bankA, ids.applicationSmall, upload.versionId),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await database.db
      .update(documentVersions)
      .set({ scanState: "blocked", scanErrorCode: "SIMULATED_BLOCKED" })
      .where(eq(documentVersions.id, upload.versionId));
    await expect(
      service().download(borrower, ids.bankA, ids.applicationSmall, upload.versionId),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      service().retryScan(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        upload.versionId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await database.db
      .update(documentVersions)
      .set({
        scanState: "error",
        scanErrorCode: "UNKNOWN_SCAN",
        scanAttempts: 1,
        scanClaimToken: randomUUID(),
      })
      .where(eq(documentVersions.id, upload.versionId));
    await service().retryScan(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      upload.versionId,
      randomUUID(),
    );
    const [version] = await database.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, upload.versionId));
    expect(version).toMatchObject({
      scanState: "pending",
      scanGeneration: 2,
      scanAttempts: 1,
      scanClaimToken: null,
      scanErrorCode: null,
    });
    await clean(upload.versionId);
    expect(
      (await service().download(borrower, ids.bankA, ids.applicationSmall, upload.versionId))
        .sha256,
    ).toBe(content.sha256);
  });
  it("keeps immutable versions, reopens completed evidence and guards clean submission", async () => {
    const task = await manual();
    const upload = await uploaded(borrower, { taskId: task.id });
    let detail = await tasks().detail(borrower, ids.bankA, ids.applicationSmall, task.id);
    expect(detail).toMatchObject({ state: "open", evidenceRevision: 1, canSubmit: false });
    await expect(
      tasks().submit(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: detail.revision },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await clean(upload.versionId);
    detail = await tasks().submit(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    detail = await tasks().review(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      {
        expectedRevision: detail.revision,
        decision: "completed",
        reason: "Reviewed synthetic evidence",
      },
      randomUUID(),
    );
    expect(detail.state).toBe("completed");
    const next = await uploaded(borrower, { replacesDocumentId: upload.documentId });
    await service().finalizeUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      next.uploadId,
      content,
      randomUUID(),
    );
    detail = await tasks().detail(borrower, ids.bankA, ids.applicationSmall, task.id);
    expect(detail).toMatchObject({ state: "open", evidenceRevision: 2, canSubmit: false });
    expect(detail.reviews).toHaveLength(1);
    const view = (await service().list(borrower, ids.bankA, ids.applicationSmall)).documents.find(
      (x) => x.id === upload.documentId,
    );
    expect(view?.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(view?.currentVersionId).toBe(next.versionId);
    expect(view?.versions[1]?.scanState).toBe("clean");
    expect(
      await database.db
        .select()
        .from(taskDocumentEvidence)
        .where(eq(taskDocumentEvidence.taskId, task.id)),
    ).toHaveLength(2);
    await clean(next.versionId);
    detail = await tasks().submit(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    await service().markMissing(next.versionId);
    await expect(
      tasks().review(
        officer,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        {
          expectedRevision: detail.revision + 1,
          decision: "completed",
          reason: "Cannot accept missing bytes",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      service().download(borrower, ids.bankA, ids.applicationSmall, next.versionId),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      (await service().list(borrower, ids.bankA, ids.applicationSmall)).documents.find(
        (x) => x.id === upload.documentId,
      )?.versions[0],
    ).toMatchObject({ uploadState: "missing", scanState: "error", scanErrorCode: "MISSING_BYTES" });
  });
  it("does not regress the latest version when earlier concurrent upload finishes late", async () => {
    const first = await uploaded();
    const old = await service().beginUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      payload({ replacesDocumentId: first.documentId }),
      randomUUID(),
    );
    const newest = await uploaded(borrower, { replacesDocumentId: first.documentId });
    await expect(
      service().finalizeUpload(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        old.uploadId,
        content,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      (await service().list(borrower, ids.bankA, ids.applicationSmall)).documents.find(
        (x) => x.id === first.documentId,
      )?.currentVersionId,
    ).toBe(newest.versionId);
  });
  it("abandons expired and cancelled reservations durably for repeatable byte cleanup", async () => {
    const abandoned = await service().beginUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      payload(),
      randomUUID(),
    );
    await service().abandonUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      abandoned.uploadId,
      randomUUID(),
    );
    await expect(
      service().upload(borrower, ids.bankA, ids.applicationSmall, abandoned.uploadId),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const input = payload();
    const expired = await service().beginUpload(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    const later = createDocumentsService(database.db, {
      clock: () => new Date(now.getTime() + 2 * 60 * 60_000),
    });
    const cleanup = await later.cleanupAbandoned();
    expect(cleanup.map((x) => x.uploadId)).toEqual(
      expect.arrayContaining([abandoned.uploadId, expired.uploadId]),
    );
    expect(await later.cleanupAbandoned()).toEqual(cleanup);
    await expect(
      later.beginUpload(borrower, ids.bankA, ids.applicationSmall, input, randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      (
        await database.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.id, expired.uploadId))
      )[0]?.uploadState,
    ).toBe("abandoned");
  });
  it("allows actual document grants on invitations and rejects unknown documents", async () => {
    const upload = await uploaded();
    const participants = createParticipantsService(database.db, {
      clock: () => now,
      borrowerOrigin: "http://localhost:3001",
      deliveryEnabled: true,
    });
    const input = {
      idempotencyKey: randomUUID(),
      email: "synthetic-doc-adviser@example.test",
      role: "adviser",
      scope: "assigned",
      taskIds: [],
      documentIds: [upload.documentId],
    };
    const view = await participants.createInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    expect(view.invitations.some((x) => x.documentIds.includes(upload.documentId))).toBe(true);
    await expect(
      participants.createInvitation(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        { ...input, idempotencyKey: randomUUID(), documentIds: [randomUUID()] },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
  });
  it("keeps safely scoped audit metadata and server-only storage keys", async () => {
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetType, "document"));
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Synthetic evidence.pdf");
    expect(serialized).not.toContain(content.sha256);
    expect(serialized).not.toContain("storageKey");
    const rows = await database.db.select().from(documents);
    expect(rows.length).toBeGreaterThan(0);
  });
});
