import { randomUUID } from "node:crypto";
import {
  applicationParticipants,
  applicationTasks,
  auditEvents,
  checkInputTasks,
  documents,
  documentVersions,
  notifications,
  signatureArtifacts,
  signatureEnvelopes,
  signatureNotificationOutbox,
  signatureProviderEvents,
  signatureSendOutbox,
  taskSignaturePolicies,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  applyVerifiedSignatureEvent,
  createDocumentsService,
  createIdentityService,
  createSignaturesService,
  createTasksService,
  signatureTaskEvidenceCurrent,
} from "@keycade/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchNotifications } from "./notification-jobs.js";
import { type Clock } from "./provider.js";
import { processSignatureJobs } from "./signatures-jobs.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
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
const borrower: Actor = { kind: "user", userId: ids.borrower },
  officer: Actor = { kind: "user", userId: ids.officerA };
const denied = { code: "NOT_FOUND", statusCode: 404 };
const api = () => createSignaturesService(database.db, { clock: () => now });
const docs = () => createDocumentsService(database.db, { clock: () => now, scanDelayMs: 0 });
const work = (extra: Parameters<typeof processSignatureJobs>[1] = {}) =>
  processSignatureJobs(database.db, { clock, delayMs: 0, retryBaseMs: 100, ...extra });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function participant(userId = ids.borrower) {
  const [p] = await database.db
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.applicationId, ids.applicationSmall),
        eq(applicationParticipants.userId, userId),
      ),
    );
  if (!p) throw new Error("Missing participant.");
  return p;
}
async function secondSigner() {
  const id = randomUUID();
  await database.db.insert(users).values({
    id,
    email: `synthetic-${id}@example.test`,
    displayName: "Synthetic Second Signer",
    emailVerifiedAt: now,
    synthetic: true,
  });
  const [p] = await database.db
    .insert(applicationParticipants)
    .values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      userId: id,
      role: "owner",
      scope: "full",
    })
    .returning();
  if (!p) throw new Error("Missing participant.");
  return { actor: { kind: "user", userId: id } as Actor, participant: p };
}
async function upload(extra: Record<string, unknown> = {}) {
  const one = await docs().beginUpload(
    borrower,
    ids.bankA,
    ids.applicationSmall,
    {
      fileName: "Synthetic signature source.pdf",
      mimeType: "application/pdf",
      expectedSize: 100,
      idempotencyKey: randomUUID(),
      ...extra,
    },
    randomUUID(),
  );
  await docs().finalizeUpload(
    borrower,
    ids.bankA,
    ids.applicationSmall,
    one.uploadId,
    { size: 100, sha256: "a".repeat(64) },
    randomUUID(),
  );
  await database.db
    .update(documentVersions)
    .set({ scanState: "clean", scannedAt: now })
    .where(eq(documentVersions.id, one.versionId));
  return one;
}
async function fixture(extra: Record<string, unknown> = {}, two = true) {
  const second = await secondSigner(),
    source = await upload(),
    owner = await participant();
  const [task] = await database.db
    .insert(applicationTasks)
    .values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      stableKey: `signature-fixture:${randomUUID()}`,
      source: "manual",
      title: "Review simulated signature",
      description: "Synthetic sample only",
      reason: "Synthetic integration fixture",
      stage: "approval",
      required: true,
      visibility: "shared",
      inputRevision: 1,
      assigneeParticipantId: owner.id,
      assigneeGenerationAt: owner.unassignedAt,
    })
    .returning();
  if (!task) throw new Error("Missing task.");
  const input = {
    taskId: task.id,
    sourceVersionId: source.versionId,
    signerParticipantIds: two ? [owner.id, second.participant.id] : [owner.id],
    idempotencyKey: randomUUID(),
    ...extra,
  };
  const created = await api().create(officer, ids.bankA, ids.applicationSmall, input, randomUUID());
  const envelope = created.envelopes.find((e) => e.taskId === task.id);
  if (!envelope) throw new Error("Missing envelope.");
  return { envelope, task, source, second, input };
}
const send = async (id: string) => {
  await api().send(officer, ids.bankA, ids.applicationSmall, id, randomUUID());
  await work();
};
const act = (id: string, actor: Actor = borrower, action: "sign" | "decline" = "sign") =>
  api().act(actor, ids.bankA, ids.applicationSmall, id, { action }, randomUUID());
async function envelope(id: string) {
  const [row] = await database.db
    .select()
    .from(signatureEnvelopes)
    .where(eq(signatureEnvelopes.id, id));
  if (!row) throw new Error("Missing envelope.");
  return row;
}
async function task(id: string) {
  const [row] = await database.db
    .select()
    .from(applicationTasks)
    .where(eq(applicationTasks.id, id));
  if (!row) throw new Error("Missing task.");
  return row;
}
describe("simulated signature lifecycle on PostgreSQL", () => {
  it("does not let a signature request replace a secure check input task", async () => {
    const f = await fixture({}, false);
    await api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    await database.db.insert(checkInputTasks).values({
      taskId: f.task.id,
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      subjectKey: "business",
      kind: "identifier",
    });
    await expect(
      api().create(
        officer,
        ids.bankA,
        ids.applicationSmall,
        { ...f.input, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      await database.db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.taskId, f.task.id)),
    ).toHaveLength(1);
  });
  it("delivers scoped signer links for source access through another task without elevating the participant", async () => {
    const f = await fixture();
    const [sourceTask] = await database.db
      .insert(applicationTasks)
      .values({
        bankId: ids.bankA,
        applicationId: ids.applicationSmall,
        stableKey: `signature-source:${randomUUID()}`,
        source: "manual",
        title: "Synthetic source task",
        description: "Synthetic document access",
        reason: "Synthetic authorization fixture",
        stage: "approval",
        required: false,
        visibility: "shared",
        inputRevision: 1,
        assigneeParticipantId: f.second.participant.id,
      })
      .returning();
    if (!sourceTask) throw new Error("Missing source task.");
    await database.db
      .update(documents)
      .set({ taskId: sourceTask.id })
      .where(eq(documents.id, f.source.documentId));
    await database.db
      .update(applicationParticipants)
      .set({ scope: "assigned", taskIds: [f.task.id, sourceTask.id] })
      .where(eq(applicationParticipants.id, f.second.participant.id));
    await send(f.envelope.id);
    await dispatchNotifications(database.db, { borrowerOrigin: "http://localhost:3000", clock });
    const [notification] = await database.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.resourceId, f.envelope.id),
          eq(notifications.recipientUserId, f.second.participant.userId),
        ),
      );
    expect(notification?.state).toBe("queued");
    if (!notification?.deliveryRequestId) throw new Error("Missing signature notification.");
    const identity = createIdentityService(database.db, { clock: () => now });
    const delivery = await identity.prepareDelivery(notification.deliveryRequestId);
    if (!delivery) throw new Error("Missing prepared signer link.");
    const token =
      new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token") ?? "";
    const session = await identity.consumeAccessLink({
      token,
      origin: "http://localhost:3000",
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    });
    expect(session.returnPath).toBe(`/signatures/${f.envelope.id}`);
    const [participant] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.id, f.second.participant.id));
    expect(participant).toMatchObject({ role: "owner", scope: "assigned" });
    expect(
      (await api().list(session.session.actor, ids.bankA, ids.applicationSmall)).envelopes.find(
        (e) => e.id === f.envelope.id,
      )?.canSign,
    ).toBe(true);
  });
  it("ignores a premature expiration callback without treating it as a signer decline", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        signerId: f.envelope.signers[0]?.id,
        type: "expired",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    expect((await envelope(f.envelope.id)).state).toBe("sent");
    expect(
      (await api().list(borrower, ids.bankA, ids.applicationSmall)).envelopes.find(
        (e) => e.id === f.envelope.id,
      )?.canSign,
    ).toBe(true);
  });
  it("ignores a late send result after staff void the in-flight envelope", async () => {
    const f = await fixture({}, false);
    await api().send(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    let start = () => {},
      finish = () => {};
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = work({
      delayMs: 25,
      clock: {
        now: () => now,
        sleep: (ms, signal) => {
          if (ms === 25) {
            start();
            return delayed;
          }
          return clock.sleep(ms, signal);
        },
      },
    });
    await started;
    await api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    finish();
    await pending;
    expect((await envelope(f.envelope.id)).state).toBe("voided");
    expect(
      await database.db
        .select()
        .from(signatureNotificationOutbox)
        .where(eq(signatureNotificationOutbox.envelopeId, f.envelope.id)),
    ).toHaveLength(0);
  });
  it("invalidates readiness when a completed signer's current participation is revoked", async () => {
    const f = await fixture();
    await send(f.envelope.id);
    await act(f.envelope.id);
    await act(f.envelope.id, f.second.actor);
    expect(await signatureTaskEvidenceCurrent(database.db, f.task.id)).toBe(true);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now, unassignedAt: now })
      .where(eq(applicationParticipants.id, f.second.participant.id));
    expect(await signatureTaskEvidenceCurrent(database.db, f.task.id)).toBe(false);
  });
  it("does not publish completion after the task evidence changes independently", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    await database.db
      .update(applicationTasks)
      .set({ evidenceRevision: 1 })
      .where(eq(applicationTasks.id, f.task.id));
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        signerId: f.envelope.signers[0]?.id,
        type: "signer_signed",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    expect((await envelope(f.envelope.id)).stale).toBe(true);
    expect(
      await database.db
        .select()
        .from(signatureArtifacts)
        .where(eq(signatureArtifacts.envelopeId, f.envelope.id)),
    ).toHaveLength(0);
  });
  it("creates an immutable idempotent binding, exposes only intended signers, and rejects another bank", async () => {
    const f = await fixture();
    await api().create(officer, ids.bankA, ids.applicationSmall, f.input, randomUUID());
    expect(
      await database.db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.taskId, f.task.id)),
    ).toHaveLength(1);
    await expect(
      api().create(
        officer,
        ids.bankA,
        ids.applicationSmall,
        { ...f.input, signerParticipantIds: [(await participant()).id] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await api().list({ kind: "user", userId: ids.adviser }, ids.bankA, ids.applicationSmall))
        .envelopes,
    ).toEqual([]);
    await expect(
      api().list({ kind: "user", userId: ids.officerB }, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject(denied);
    expect(
      (await api().list(f.second.actor, ids.bankA, ids.applicationSmall)).envelopes.some(
        (e) => e.id === f.envelope.id,
      ),
    ).toBe(true);
  });
  it("remains partial until both intended users sign and publishes one immutable simulated artifact", async () => {
    const f = await fixture();
    await send(f.envelope.id);
    expect(
      await database.db
        .select()
        .from(signatureNotificationOutbox)
        .where(eq(signatureNotificationOutbox.envelopeId, f.envelope.id)),
    ).toHaveLength(2);
    await act(f.envelope.id);
    expect((await envelope(f.envelope.id)).state).toBe("partially_signed");
    expect((await task(f.task.id)).state).toBe("open");
    await act(f.envelope.id, f.second.actor);
    expect((await envelope(f.envelope.id)).state).toBe("completed");
    expect(await task(f.task.id)).toMatchObject({
      state: "completed",
      evidenceRevision: 1,
      reviewedEvidenceRevision: 1,
    });
    const artifact = await api().artifact(borrower, ids.bankA, ids.applicationSmall, f.envelope.id);
    expect(artifact.body).toContain("not a legally executed contract");
    expect(artifact.body).toContain(f.source.versionId);
    await act(f.envelope.id, f.second.actor);
    expect(
      await database.db
        .select()
        .from(signatureArtifacts)
        .where(eq(signatureArtifacts.envelopeId, f.envelope.id)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetId, f.envelope.id),
            eq(auditEvents.action, "signature.system_completed"),
          ),
        ),
    ).toHaveLength(1);
    await expect(
      api().artifact(
        { kind: "user", userId: ids.adviser },
        ids.bankA,
        ids.applicationSmall,
        f.envelope.id,
      ),
    ).rejects.toMatchObject(denied);
  });
  it("deduplicates verified callbacks and never reverses terminal states for reordered events", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    const event = {
      eventId: randomUUID(),
      envelopeId: f.envelope.id,
      signerId: f.envelope.signers[0]?.id,
      type: "signer_signed",
      occurredAt: now.toISOString(),
    };
    await applyVerifiedSignatureEvent(database.db, event, { now });
    await applyVerifiedSignatureEvent(database.db, event, { now });
    await applyVerifiedSignatureEvent(
      database.db,
      {
        ...event,
        eventId: randomUUID(),
        type: "signer_declined",
        occurredAt: new Date(now.getTime() - 1000).toISOString(),
      },
      { now },
    );
    await applyVerifiedSignatureEvent(
      database.db,
      { ...event, eventId: randomUUID(), type: "voided" },
      { now },
    );
    expect((await envelope(f.envelope.id)).state).toBe("completed");
    expect(
      await database.db
        .select()
        .from(signatureArtifacts)
        .where(eq(signatureArtifacts.envelopeId, f.envelope.id)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(signatureProviderEvents)
        .where(eq(signatureProviderEvents.envelopeId, f.envelope.id)),
    ).toHaveLength(3);
    await expect(
      applyVerifiedSignatureEvent(database.db, { ...event, type: "signer_declined" }, { now }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("does not allow staff or another participant to act for the intended signer", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    for (const actor of [officer, f.second.actor, { kind: "user", userId: ids.adviser } as Actor])
      await expect(act(f.envelope.id, actor)).rejects.toMatchObject(denied);
    expect((await envelope(f.envelope.id)).state).toBe("sent");
  });
  it("revokes signer links immediately and does not revive them after participant regrant", async () => {
    const f = await fixture();
    await send(f.envelope.id);
    await act(f.envelope.id);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now, unassignedAt: now })
      .where(eq(applicationParticipants.id, f.second.participant.id));
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, f.second.participant.id));
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject(denied);
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        signerId: f.envelope.signers.find((s) => s.participantId === f.second.participant.id)?.id,
        type: "signer_signed",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    expect((await task(f.task.id)).state).toBe("open");
  });
  it("requires current verified email and rechecks source/task grants for signing", async () => {
    const f = await fixture();
    await send(f.envelope.id);
    await database.db
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, f.second.participant.userId));
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject(denied);
    await database.db
      .update(users)
      .set({ emailVerifiedAt: now, email: `changed-${randomUUID()}@example.test` })
      .where(eq(users.id, f.second.participant.userId));
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject(denied);
    await database.db
      .update(documents)
      .set({ visibility: "private", subjectUserId: ids.borrower })
      .where(eq(documents.id, f.source.documentId));
    expect(
      (await api().list(f.second.actor, ids.bankA, ids.applicationSmall)).envelopes.some(
        (e) => e.id === f.envelope.id,
      ),
    ).toBe(false);
  });
  it("ignores completion for a replaced source and requires a fresh envelope", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    const replacement = await upload({ replacesDocumentId: f.source.documentId });
    await expect(act(f.envelope.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        signerId: f.envelope.signers[0]?.id,
        type: "signer_signed",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    expect((await task(f.task.id)).state).toBe("open");
    const fresh = await api().create(
      officer,
      ids.bankA,
      ids.applicationSmall,
      { ...f.input, sourceVersionId: replacement.versionId, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(fresh.envelopes.filter((e) => e.taskId === f.task.id)).toHaveLength(2);
  });
  it("reopens completed signature evidence when an unrelated source document is replaced", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    await act(f.envelope.id);
    const artifact = await api().artifact(borrower, ids.bankA, ids.applicationSmall, f.envelope.id);
    await upload({ replacesDocumentId: f.source.documentId });
    expect(await task(f.task.id)).toMatchObject({
      state: "open",
      evidenceRevision: 2,
      reviewedEvidenceRevision: null,
    });
    expect((await envelope(f.envelope.id)).stale).toBe(true);
    expect(await api().artifact(borrower, ids.bankA, ids.applicationSmall, f.envelope.id)).toEqual(
      artifact,
    );
  });
  it("reopens completed signature evidence when source bytes are missing", async () => {
    const f = await fixture({}, false);
    await send(f.envelope.id);
    await act(f.envelope.id);
    await docs().markMissing(f.source.versionId);
    expect((await task(f.task.id)).state).toBe("open");
    expect((await envelope(f.envelope.id)).stale).toBe(true);
  });
  it("keeps decline terminal and allows recovery through a new envelope", async () => {
    const f = await fixture();
    await send(f.envelope.id);
    await act(f.envelope.id, borrower, "decline");
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(
      api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const next = await api().create(
      officer,
      ids.bankA,
      ids.applicationSmall,
      { ...f.input, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(next.envelopes.filter((e) => e.taskId === f.task.id)).toHaveLength(2);
  });
  it("expires pending/partial requests with the injected clock and rejects late actions", async () => {
    const f = await fixture({ expiresAt: new Date(now.getTime() + 1000).toISOString() });
    await send(f.envelope.id);
    await act(f.envelope.id);
    now = new Date(now.getTime() + 1001);
    await expect(
      api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        type: "voided",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    await work();
    expect((await envelope(f.envelope.id)).state).toBe("expired");
    await expect(act(f.envelope.id, f.second.actor)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect((await task(f.task.id)).state).toBe("open");
  });
  it("voids a draft idempotently and does not allow callbacks to revive it", async () => {
    const f = await fixture({}, false);
    await api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    await api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    await applyVerifiedSignatureEvent(
      database.db,
      {
        eventId: randomUUID(),
        envelopeId: f.envelope.id,
        signerId: f.envelope.signers[0]?.id,
        type: "signer_signed",
        occurredAt: now.toISOString(),
      },
      { now },
    );
    expect((await envelope(f.envelope.id)).state).toBe("voided");
  });
  it("durably queues send once and backs off a transient failure before creating notification intents", async () => {
    const f = await fixture({ scenario: "transient_error" }, false);
    await Promise.all([
      api().send(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID()),
      api().send(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID()),
    ]);
    expect(
      await database.db
        .select()
        .from(signatureSendOutbox)
        .where(eq(signatureSendOutbox.envelopeId, f.envelope.id)),
    ).toHaveLength(1);
    await work();
    expect(await envelope(f.envelope.id)).toMatchObject({
      deliveryStatus: "pending",
      sendError: "transient_error",
      sendAttempts: 1,
    });
    expect(
      await database.db
        .select()
        .from(signatureNotificationOutbox)
        .where(eq(signatureNotificationOutbox.envelopeId, f.envelope.id)),
    ).toHaveLength(0);
    await work();
    expect((await envelope(f.envelope.id)).sendAttempts).toBe(1);
    now = new Date(now.getTime() + 101);
    await work();
    expect(await envelope(f.envelope.id)).toMatchObject({ state: "sent", sendAttempts: 2 });
  });
  it("shows terminal send errors and provides an explicit retry generation", async () => {
    const f = await fixture({ scenario: "terminal_error" }, false);
    await send(f.envelope.id);
    expect(await envelope(f.envelope.id)).toMatchObject({
      state: "draft",
      deliveryStatus: "failed",
      sendError: "terminal_error",
    });
    await api().retrySend(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    expect((await envelope(f.envelope.id)).sendGeneration).toBe(2);
    await work();
    expect(
      await database.db
        .select()
        .from(signatureSendOutbox)
        .where(eq(signatureSendOutbox.envelopeId, f.envelope.id)),
    ).toHaveLength(2);
    expect((await task(f.task.id)).state).toBe("open");
  });
  it("rolls back envelopes and policies when a signer cannot access private source evidence", async () => {
    const f = await fixture({}, false);
    await api().void(officer, ids.bankA, ids.applicationSmall, f.envelope.id, randomUUID());
    await database.db
      .update(documents)
      .set({ visibility: "private", subjectUserId: ids.borrower })
      .where(eq(documents.id, f.source.documentId));
    await database.db
      .update(applicationTasks)
      .set({ visibility: "private", subjectUserId: ids.borrower })
      .where(eq(applicationTasks.id, f.task.id));
    await expect(
      api().create(
        officer,
        ids.bankA,
        ids.applicationSmall,
        {
          ...f.input,
          signerParticipantIds: [f.second.participant.id],
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      await database.db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.taskId, f.task.id)),
    ).toHaveLength(1);
    expect(
      (
        await database.db
          .select()
          .from(taskSignaturePolicies)
          .where(eq(taskSignaturePolicies.taskId, f.task.id))
      )[0]?.envelopeId,
    ).toBe(f.envelope.id);
  });
  it("blocks generic task answers from satisfying signature-owned tasks", async () => {
    const f = await fixture({}, false);
    const taskView = (
      await createTasksService(database.db).read(officer, ids.bankA, ids.applicationSmall)
    ).tasks.find((t) => t.id === f.task.id);
    expect(taskView).toMatchObject({
      inputKind: "signature",
      signatureEnvelopeId: f.envelope.id,
      canEdit: false,
      canSubmit: false,
      canReview: false,
    });
    await expect(
      createTasksService(database.db).saveAnswer(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        f.task.id,
        { answer: "confirmed", expectedRevision: (await task(f.task.id)).revision },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
