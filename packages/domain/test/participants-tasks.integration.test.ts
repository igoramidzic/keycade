import { randomUUID } from "node:crypto";
import { applicationParticipants, applicationTasks, taskAnswers, users } from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, createApplicationService, createParticipantsService } from "../src/index.js";
import { createTasksService } from "../src/tasks.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const officer: Actor = { kind: "user", userId: ids.officerA };
const borrower: Actor = { kind: "user", userId: ids.borrower };
const denied = { code: "NOT_FOUND", statusCode: 404 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());

function harness() {
  let now = new Date("2026-10-07T16:00:00Z");
  return {
    service: createParticipantsService(database.db, {
      clock: () => now,
      borrowerOrigin: "http://localhost:3001",
      deliveryEnabled: true,
    }),
    advance() {
      now = new Date(now.getTime() + 1_000);
    },
  };
}
async function person() {
  const id = randomUUID();
  const email = `task-participant-${id}@example.test`;
  await database.db.insert(users).values({
    id,
    email,
    displayName: "Synthetic task participant",
    synthetic: true,
    emailVerifiedAt: new Date("2026-10-07T12:00:00Z"),
  });
  return { id, email, actor: { kind: "user", userId: id } as Actor };
}
async function task(overrides: Partial<typeof applicationTasks.$inferInsert> = {}) {
  const [row] = await database.db
    .insert(applicationTasks)
    .values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      stableKey: `manual:${randomUUID()}`,
      source: "manual",
      title: "Synthetic participant requirement",
      description: "Synthetic answer only.",
      reason: "Staff requested this synthetic answer.",
      stage: "submission",
      required: true,
      visibility: "shared",
      inputRevision: 1,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("Expected task.");
  return row;
}
async function invite(
  service: ReturnType<typeof harness>["service"],
  target: Awaited<ReturnType<typeof person>>,
  taskIds: string[],
  actor = officer,
) {
  const workspace = await service.createInvitation(
    actor,
    ids.bankA,
    ids.applicationSmall,
    {
      email: target.email,
      role: "owner",
      scope: "assigned",
      taskIds,
      idempotencyKey: randomUUID(),
    },
    randomUUID(),
  );
  const invitation = workspace.invitations
    .filter((row) => row.email === target.email && row.status === "pending")
    .at(-1);
  if (!invitation) throw new Error("Expected invitation.");
  return invitation;
}

describe("participant task grants and owner facts on PostgreSQL", () => {
  it("accepts only current same-application grants and scopes borrower progress to permitted tasks", async () => {
    const { service } = harness();
    const target = await person();
    const shared = await task();
    const privateOther = await task({ visibility: "private", subjectUserId: ids.borrower });
    const otherApplication = await task({ applicationId: ids.applicationLarge });
    const otherBank = await task({ bankId: ids.bankB, applicationId: ids.applicationOtherBank });
    for (const taskId of [privateOther.id, otherApplication.id, otherBank.id, randomUUID()]) {
      await expect(invite(service, target, [taskId])).rejects.toMatchObject(denied);
    }
    await expect(invite(service, target, [privateOther.id], borrower)).rejects.toMatchObject(
      denied,
    );
    const invitation = await invite(service, target, [shared.id], borrower);
    await service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID());
    const portal = await createApplicationService(database.db).portal(
      target.actor,
      ids.bankA,
      ids.applicationSmall,
    );
    expect(portal.taskProgress).toMatchObject({ total: 1, completed: 0, required: 1 });
    expect(portal.remainingTasks).toBe(1);
    const list = await createApplicationService(database.db).list(target.actor, ids.bankA);
    expect(list.items.find((row) => row.id === ids.applicationSmall)?.taskProgress).toEqual(
      portal.taskProgress,
    );
  });

  it("rechecks changed privacy at invitation acceptance and resend", async () => {
    const { service } = harness();
    const target = await person();
    const shared = await task();
    const invitation = await invite(service, target, [shared.id]);
    await database.db
      .update(applicationTasks)
      .set({ visibility: "private", subjectUserId: ids.borrower })
      .where(eq(applicationTasks.id, shared.id));
    await expect(
      service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    await expect(
      service.resendInvitation(
        officer,
        ids.bankA,
        ids.applicationSmall,
        invitation.id,
        { idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    expect(await service.readInvitation(target.actor, ids.bankA, invitation.id)).toMatchObject({
      canAccept: false,
      businessName: null,
    });
  });

  it("unassigns unfinished work at revocation, preserves completed authorship, and never restores assignment on reinvite", async () => {
    const { service, advance } = harness();
    const target = await person();
    const open = await task();
    const invitation = await invite(service, target, [open.id]);
    await service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID());
    const [participant] = await database.db
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.applicationId, ids.applicationSmall),
          eq(applicationParticipants.userId, target.id),
        ),
      );
    if (!participant) throw new Error("Expected participant.");
    await database.db
      .update(applicationTasks)
      .set({ assigneeParticipantId: participant.id })
      .where(eq(applicationTasks.id, open.id));
    const submitted = await task({
      state: "submitted",
      evidenceRevision: 1,
      assigneeParticipantId: participant.id,
    });
    const completed = await task({
      state: "completed",
      evidenceRevision: 1,
      reviewedEvidenceRevision: 1,
      assigneeParticipantId: participant.id,
    });
    for (const row of [submitted, completed])
      await database.db.insert(taskAnswers).values({
        bankId: ids.bankA,
        applicationId: ids.applicationSmall,
        taskId: row.id,
        evidenceRevision: 1,
        authorUserId: target.id,
        answer: "Synthetic retained evidence",
      });
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    for (const row of [open, submitted]) {
      const [updated] = await database.db
        .select()
        .from(applicationTasks)
        .where(eq(applicationTasks.id, row.id));
      expect(updated?.assigneeParticipantId).toBeNull();
      expect(updated?.revision).toBe(row.revision + 1);
    }
    const [completedAfter] = await database.db
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.id, completed.id));
    expect(completedAfter).toMatchObject({
      state: "completed",
      assigneeParticipantId: participant.id,
    });
    expect(
      await database.db.select().from(taskAnswers).where(eq(taskAnswers.authorUserId, target.id)),
    ).toHaveLength(2);
    advance();
    const again = await invite(service, target, [open.id]);
    await service.acceptInvitation(target.actor, ids.bankA, again.id, randomUUID());
    const [reinvited] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.id, participant.id));
    expect(reinvited?.revokedAt).toBeNull();
    expect(reinvited?.unassignedAt).toBeInstanceOf(Date);
    const [unassigned] = await database.db
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.id, open.id));
    expect(unassigned?.assigneeParticipantId).toBeNull();
  });

  it("reconciles owner removal and restoration under the same relationship without restoring a waiver", async () => {
    const { service } = harness();
    const name = `Synthetic owner ${randomUUID()}`;
    const workspace = await service.addRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      {
        displayName: name,
        kind: "owner",
        ownershipPercent: "30.00",
        userId: ids.borrower,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    // Frozen clocks give several owners the same timestamp; UUID sorting is not creation order.
    const relationship = workspace.relationships.find((row) => row.displayName === name);
    if (!relationship) throw new Error("Expected relationship.");
    const related = await database.db
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.subjectRelationshipId, relationship.id));
    expect(related.length).toBeGreaterThan(0);
    const original = related[0];
    if (!original) throw new Error("Expected owner task.");
    await database.db
      .update(applicationTasks)
      .set({ state: "waived" })
      .where(eq(applicationTasks.id, original.id));
    const removed = await service.setRelationshipActive(
      officer,
      ids.bankA,
      ids.applicationSmall,
      relationship.id,
      { active: false, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(removed.relationships.find((row) => row.id === relationship.id)?.active).toBe(false);
    await service.setRelationshipActive(
      officer,
      ids.bankA,
      ids.applicationSmall,
      relationship.id,
      { active: true, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    const occurrences = await database.db
      .select()
      .from(applicationTasks)
      .where(
        and(
          eq(applicationTasks.subjectRelationshipId, relationship.id),
          eq(applicationTasks.stableKey, original.stableKey),
        ),
      );
    expect(occurrences).toHaveLength(2);
    expect(occurrences.find((row) => row.id === original.id)?.state).toBe("cancelled");
    expect(occurrences.find((row) => row.id !== original.id)).toMatchObject({
      occurrence: 2,
      state: "open",
      evidenceRevision: 0,
    });
    const different = await person();
    await expect(
      service.linkRelationship(
        officer,
        ids.bankA,
        ids.applicationSmall,
        relationship.id,
        { userId: different.id, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("keeps completed assignments historical after reinvite and makes explicit history grants read-only", async () => {
    const { service, advance } = harness();
    const target = await person();
    const invitation = await invite(service, target, []);
    await service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID());
    const [participant] = await database.db
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.applicationId, ids.applicationSmall),
          eq(applicationParticipants.userId, target.id),
        ),
      );
    if (!participant) throw new Error("Expected participant.");
    const tasks = createTasksService(database.db, {
      clock: () => new Date("2026-10-07T16:00:00Z"),
    });
    const title = `Synthetic completed assignment ${randomUUID()}`;
    const created = await tasks.createManual(
      officer,
      ids.bankA,
      ids.applicationSmall,
      {
        title,
        description: "Synthetic assignment lifecycle test",
        visibility: "assigned",
        assigneeParticipantId: participant.id,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const original = created.tasks.find((row) => row.title === title);
    if (!original) throw new Error("Expected task.");
    let detail = await tasks.saveAnswer(
      target.actor,
      ids.bankA,
      ids.applicationSmall,
      original.id,
      { expectedRevision: original.revision, answer: "Synthetic completed evidence" },
      randomUUID(),
    );
    detail = await tasks.submit(
      target.actor,
      ids.bankA,
      ids.applicationSmall,
      original.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    detail = await tasks.review(
      officer,
      ids.bankA,
      ids.applicationSmall,
      original.id,
      {
        expectedRevision: detail.revision,
        decision: "completed",
        reason: "Synthetic review complete",
      },
      randomUUID(),
    );
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    advance();
    const empty = await invite(service, target, []);
    await service.acceptInvitation(target.actor, ids.bankA, empty.id, randomUUID());
    await expect(
      tasks.detail(target.actor, ids.bankA, ids.applicationSmall, original.id),
    ).rejects.toMatchObject(denied);
    await expect(
      tasks.saveAnswer(
        target.actor,
        ids.bankA,
        ids.applicationSmall,
        original.id,
        { expectedRevision: detail.revision, answer: "Synthetic forbidden edit" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    expect(
      (
        await createApplicationService(database.db).portal(
          target.actor,
          ids.bankA,
          ids.applicationSmall,
        )
      ).taskProgress?.total,
    ).toBe(0);
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    advance();
    const history = await invite(service, target, [original.id]);
    await service.acceptInvitation(target.actor, ids.bankA, history.id, randomUUID());
    const granted = await tasks.detail(target.actor, ids.bankA, ids.applicationSmall, original.id);
    expect(granted).toMatchObject({ state: "completed", canEdit: false, canSubmit: false });
    expect(granted.answers[0]?.authorUserId).toBe(target.id);
    await expect(
      tasks.saveAnswer(
        target.actor,
        ids.bankA,
        ids.applicationSmall,
        original.id,
        { expectedRevision: granted.revision, answer: "Synthetic forbidden history edit" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
  });
  it("links an unclaimed owner only to an active same-application participant and keeps earlier evidence private", async () => {
    const { service } = harness();
    const target = await person();
    const invitation = await invite(service, target, []);
    await service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID());
    const name = `Synthetic unlinked owner ${randomUUID()}`;
    const workspace = await service.addRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      {
        displayName: name,
        kind: "owner",
        ownershipPercent: "20.00",
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const relationship = workspace.relationships.find((row) => row.displayName === name);
    if (!relationship) throw new Error("Expected relationship.");
    const [original] = await database.db
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.subjectRelationshipId, relationship.id));
    if (!original) throw new Error("Expected owner task.");
    await database.db.insert(taskAnswers).values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      taskId: original.id,
      evidenceRevision: 1,
      authorUserId: ids.officerA,
      answer: "Synthetic prior staff evidence",
    });
    const outsider = await person();
    await expect(
      service.linkRelationship(
        officer,
        ids.bankA,
        ids.applicationSmall,
        relationship.id,
        { userId: outsider.id, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    const input = { userId: target.id, idempotencyKey: randomUUID() };
    await service.linkRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      relationship.id,
      input,
      randomUUID(),
    );
    await service.linkRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      relationship.id,
      input,
      randomUUID(),
    );
    const rows = await database.db
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.subjectRelationshipId, relationship.id));
    expect(rows).toHaveLength(2);
    const linked = rows.find((row) => row.state !== "cancelled");
    expect(linked).toMatchObject({ subjectUserId: target.id, state: "open", evidenceRevision: 0 });
    const tasks = createTasksService(database.db);
    await expect(
      tasks.detail(target.actor, ids.bankA, ids.applicationSmall, original.id),
    ).rejects.toMatchObject(denied);
    if (!linked) throw new Error("Expected linked task.");
    expect(
      await tasks.detail(target.actor, ids.bankA, ids.applicationSmall, linked.id),
    ).toMatchObject({ answer: null, answers: [] });
  });
});
