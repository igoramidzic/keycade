import { randomUUID } from "node:crypto";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  auditEvents,
  checkRuns,
  documents,
  documentVersions,
  integrationRuns,
  outboxEvents,
  workerHeartbeats,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  type Actor,
  createActivityService,
  createDocumentsService,
  createIdentifierCipher,
  createOperationsService,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const adviser: Actor = { kind: "user", userId: ids.adviser };
const now = new Date("2026-10-07T17:00:00Z");
const activity = () => createActivityService(database.db);
const operations = () =>
  createOperationsService(database.db, {
    cipher: createIdentifierCipher("37".repeat(32)),
    clock: () => now,
  });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function fixture() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic seed.");
  const id = randomUUID();
  await database.db.insert(applications).values({ ...source, id, revision: 1 });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: now,
    completedByUserId: ids.borrower,
  });
  const participants = await database.db
    .insert(applicationParticipants)
    .values([
      {
        bankId: ids.bankA,
        applicationId: id,
        userId: ids.borrower,
        role: "applicant_admin" as const,
        scope: "full" as const,
        synthetic: true,
      },
      {
        bankId: ids.bankA,
        applicationId: id,
        userId: ids.adviser,
        role: "adviser" as const,
        scope: "assigned" as const,
        synthetic: true,
      },
    ])
    .returning();
  const tasks = await database.db
    .insert(applicationTasks)
    .values(
      (["shared", "private", "assigned"] as const).map((visibility) => ({
        bankId: ids.bankA,
        applicationId: id,
        stableKey: randomUUID(),
        source: "manual" as const,
        title: "Synthetic confidential requirement",
        description: "Synthetic secret answer must not appear",
        reason: "Synthetic private reason",
        stage: "submission" as const,
        required: true,
        visibility,
        subjectUserId: visibility === "private" ? ids.adviser : null,
        inputRevision: 1,
        assigneeParticipantId:
          visibility === "assigned" ? participants.find((p) => p.userId === ids.adviser)!.id : null,
      })),
    )
    .returning();
  return { id, participants, tasks };
}
async function event(
  id: string,
  action: string,
  type: string,
  targetId: string,
  actor: string = ids.officerA,
) {
  const [row] = await database.db
    .insert(auditEvents)
    .values({
      bankId: ids.bankA,
      applicationId: id,
      actorType: "user",
      actorUserId: actor,
      action,
      targetType: type,
      targetId,
      requestId: randomUUID(),
      metadata: { secret: "PRIVATE-NOTE-DO-NOT-RENDER", email: "private@example.test" },
      createdAt: now,
    })
    .returning();
  return row!;
}
it("filters private and unassigned histories before pagination without exposing note text or hidden counts", async () => {
  const f = await fixture();
  const [shared, privateTask, assigned] = f.tasks;
  await event(f.id, "application.created", "application", f.id, ids.borrower);
  const visible = await event(f.id, "task.review", "task", shared!.id);
  const hidden = await event(f.id, "task.review", "task", privateTask!.id);
  const limited = await event(f.id, "task.review", "task", assigned!.id);
  await event(f.id, "staff_note.created", "staff_note", randomUUID());
  await event(f.id, "future.unknown_action", "application", f.id);
  const borrowerView = await activity().list(borrower, ids.bankA, f.id);
  expect(borrowerView.entries.map((e) => e.id)).toContain(visible.id);
  expect(borrowerView.entries.map((e) => e.id)).not.toContain(hidden.id);
  expect(borrowerView.entries.map((e) => e.id)).not.toContain(limited.id);
  expect(borrowerView.entries).toHaveLength(2);
  expect(borrowerView.entries.every((e) => e.reference === null)).toBe(true);
  const limitedView = await activity().list(adviser, ids.bankA, f.id, { limit: 1 });
  expect(limitedView.entries.map((e) => e.id)).toEqual([limited.id]);
  expect(limitedView.nextCursor).toBeNull();
  const staff = await activity().list(officer, ids.bankA, f.id);
  expect(staff.entries).toHaveLength(5);
  expect(staff.entries.some((e) => e.description === "Internal note added")).toBe(true);
  expect(JSON.stringify([borrowerView, limitedView, staff])).not.toMatch(
    /PRIVATE-NOTE|private@example|Synthetic confidential|secret answer/,
  );
});
it("loads linked-task document activity in a bounded batch and honors reassignment", async () => {
  const f = await fixture();
  const assigned = f.tasks.find((task) => task.visibility === "assigned")!;
  const privateTask = f.tasks.find((task) => task.visibility === "private")!;
  const files = await database.db
    .insert(documents)
    .values(
      Array.from({ length: 12 }, () => ({
        bankId: ids.bankA,
        applicationId: f.id,
        taskId: assigned.id,
        visibility: "shared" as const,
        createdByUserId: ids.borrower,
      })),
    )
    .returning();
  for (const file of files) await event(f.id, "document.upload_finished", "document", file.id);
  const [hidden] = await database.db
    .insert(documents)
    .values({
      bankId: ids.bankA,
      applicationId: f.id,
      taskId: privateTask.id,
      visibility: "private",
      subjectUserId: ids.borrower,
      createdByUserId: ids.borrower,
    })
    .returning();
  await event(f.id, "document.upload_finished", "document", hidden!.id);
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    const view = await activity().list(adviser, ids.bankA, f.id);
    expect(view.entries).toHaveLength(12);
    const statements = spy.mock.calls.map(([query]: unknown[]) =>
      typeof query === "string" ? query : (query as { text: string }).text,
    );
    expect(statements.filter((query) => query.includes('from "application_tasks"'))).toHaveLength(
      1,
    );
  } finally {
    spy.mockRestore();
  }
  await database.db
    .update(applicationTasks)
    .set({ assigneeParticipantId: null })
    .where(eq(applicationTasks.id, assigned.id));
  expect((await activity().list(adviser, ids.bankA, f.id)).entries).toEqual([]);
});

it("keeps a stable microsecond-aware cursor without skips or duplicates on tied timestamps", async () => {
  const f = await fixture();
  const a = await event(f.id, "application.created", "application", f.id);
  const b = await event(f.id, "application.submit", "application", f.id);
  // Insert immutable audits at sub-millisecond precision, as PostgreSQL does by default.
  await database.pool.query(
    "INSERT INTO audit_events(bank_id,application_id,actor_type,actor_user_id,action,target_type,target_id,request_id,created_at) VALUES($1,$2,'user',$3,'application.approve','application',$2,$4,'2026-10-07T17:00:00.000123Z'),($1,$2,'user',$3,'application.closing_started','application',$2,$4,'2026-10-07T17:00:00.000456Z')",
    [ids.bankA, f.id, ids.officerA, randomUUID()],
  );
  let cursor: string | undefined;
  const seen: string[] = [];
  do {
    const page = await activity().list(borrower, ids.bankA, f.id, {
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.entries.map((e) => e.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toHaveLength(4);
  expect(new Set(seen).size).toBe(4);
  expect(seen.slice(-2)).toEqual([a.id, b.id].sort().reverse());
  await expect(
    activity().list(officer, ids.bankA, f.id, { cursor: "invalid" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
it("retains replaced document history while enforcing current grants and revocation", async () => {
  const f = await fixture();
  const [doc] = await database.db
    .insert(documents)
    .values({
      bankId: ids.bankA,
      applicationId: f.id,
      visibility: "assigned",
      currentVersion: 2,
      createdByUserId: ids.borrower,
    })
    .returning();
  await database.db
    .update(applicationParticipants)
    .set({ documentIds: [doc!.id] })
    .where(
      eq(applicationParticipants.id, f.participants.find((p) => p.userId === ids.adviser)!.id),
    );
  const old = await event(f.id, "document.upload_finished", "document", doc!.id);
  expect((await activity().list(adviser, ids.bankA, f.id)).entries.map((e) => e.id)).toContain(
    old.id,
  );
  await database.db
    .update(applicationParticipants)
    .set({ documentIds: [] })
    .where(
      eq(applicationParticipants.id, f.participants.find((p) => p.userId === ids.adviser)!.id),
    );
  expect((await activity().list(adviser, ids.bankA, f.id)).entries).toEqual([]);
  expect((await activity().list(officer, ids.bankA, f.id)).entries.map((e) => e.id)).toContain(
    old.id,
  );
  await database.db
    .update(applicationParticipants)
    .set({ revokedAt: now })
    .where(
      and(
        eq(applicationParticipants.applicationId, f.id),
        eq(applicationParticipants.userId, ids.adviser),
      ),
    );
  await expect(activity().list(adviser, ids.bankA, f.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("denies all cross-bank, anonymous and system diagnostics and honors the setup gate", async () => {
  const f = await fixture();
  for (const actor of [
    { kind: "anonymous" },
    { kind: "user", userId: ids.officerB },
    {
      kind: "system",
      bankId: ids.bankA,
      applicationIds: [f.id],
      capabilities: ["application:read"],
    },
  ] as Actor[]) {
    await expect(activity().list(actor, ids.bankA, f.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(operations().read(actor, ids.bankA, f.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }
  await expect(operations().read(borrower, ids.bankA, f.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await database.db
    .update(applicationSetups)
    .set({ completedAt: null })
    .where(eq(applicationSetups.applicationId, f.id));
  await expect(activity().list(borrower, ids.bankA, f.id)).rejects.toMatchObject({
    code: "SETUP_REQUIRED",
  });
});
it("shows missing/stale worker and old backlog, then retries only a current failed scan through the audited use case", async () => {
  const f = await fixture();
  const docs = createDocumentsService(database.db, { clock: () => now });
  const started = await docs.beginUpload(
    officer,
    ids.bankA,
    f.id,
    {
      idempotencyKey: randomUUID(),
      fileName: "Synthetic retry.pdf",
      mimeType: "application/pdf",
      expectedSize: 100,
    },
    randomUUID(),
  );
  await database.db
    .update(documentVersions)
    .set({
      uploadState: "uploaded",
      uploadedAt: now,
      sha256: "a".repeat(64),
      scanState: "error",
      scanErrorCode: "scanner_unavailable",
      scanAttempts: 3,
    })
    .where(eq(documentVersions.id, started.versionId));
  await database.db
    .update(documents)
    .set({ currentVersion: 1 })
    .where(eq(documents.id, started.documentId));
  await database.db.delete(workerHeartbeats);
  let view = await operations().read(officer, ids.bankA, f.id);
  expect(view.worker.state).toBe("unknown");
  expect(view.items.find((i) => i.resourceId === started.versionId)).toMatchObject({
    attempts: 3,
    status: "error",
    actions: ["retry_scan"],
  });
  await database.db.insert(workerHeartbeats).values({
    workerId: "synthetic-offline",
    startedAt: new Date(now.getTime() - 3600000),
    seenAt: new Date(now.getTime() - 3600000),
  });
  expect((await operations().read(officer, ids.bankA, f.id)).worker.state).toBe("offline");
  const command = { action: "retry_scan", resourceId: started.versionId };
  await expect(
    operations().act(borrower, ids.bankA, f.id, command, randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    operations().act(officer, ids.bankA, f.id, { ...command, action: "delete" }, randomUUID()),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  view = await operations().act(officer, ids.bankA, f.id, command, randomUUID());
  expect(view.items.find((i) => i.resourceId === started.versionId)?.actions).toEqual([]);
  await expect(
    operations().act(officer, ids.bankA, f.id, command, randomUUID()),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(
    (await activity().list(officer, ids.bankA, f.id)).entries.some(
      (e) => e.description === "Document scan retried",
    ),
  ).toBe(true);
  await database.db.update(workerHeartbeats).set({ seenAt: now });
  expect((await operations().read(officer, ids.bankA, f.id)).worker.state).toBe("healthy");
});

it("shows waiting checks without inventing queued work and counts old outbox intent only in its application scope", async () => {
  const f = await fixture();
  // A legacy frozen application may retain its check policy without any execution history.
  await operations().read(officer, ids.bankA, f.id);
  await database.db
    .update(applications)
    .set({ status: "approved" })
    .where(eq(applications.id, f.id));
  await database.db.delete(checkRuns).where(eq(checkRuns.applicationId, f.id));
  const before = await operations().read(officer, ids.bankA, f.id);
  expect(before.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "check",
        runId: null,
        status: "waiting_for_input",
        attempts: 0,
        stale: false,
        actions: [],
      }),
    ]),
  );
  const waiting = before.items.find((item) => item.kind === "check" && item.runId === null)!;
  await expect(
    operations().act(
      officer,
      ids.bankA,
      f.id,
      { action: "retry_check", resourceId: waiting.resourceId },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  const old = new Date(now.getTime() - 86400000);
  const createOutbox = async (
    bankId: string,
    applicationId: string,
    createdAt: Date,
    dispatchedAt: Date | null,
  ) => {
    const [run] = await database.db
      .insert(integrationRuns)
      .values({
        bankId,
        applicationId,
        inputRevision: 1,
        scenario: "success",
        status: "queued",
        requestId: randomUUID(),
        createdAt,
      })
      .returning();
    await database.db
      .insert(outboxEvents)
      .values({ bankId, applicationId, runId: run!.id, createdAt, dispatchedAt });
  };
  await createOutbox(ids.bankA, f.id, old, null);
  await createOutbox(ids.bankA, f.id, new Date(old.getTime() - 86400000), now);
  await createOutbox(
    ids.bankB,
    ids.applicationOtherBank,
    new Date(old.getTime() - 2 * 86400000),
    null,
  );
  const after = await operations().read(officer, ids.bankA, f.id);
  expect(after.backlog).toEqual({
    pending: before.backlog.pending + 1,
    overdue: before.backlog.overdue + 1,
    oldestAt: old.toISOString(),
  });
  expect(
    after.items.filter((item) => item.kind === "check" && item.status === "waiting_for_input"),
  ).toHaveLength(2);
});
