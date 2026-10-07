import { randomUUID } from "node:crypto";
import {
  applicationParticipants,
  applicationRequirementPolicies,
  applications,
  applicationTasks,
  businessRelationships,
  loanProducts,
  productRequirementRules,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createTasksService,
  demoRequirementRules,
  reconcileTasks,
  requireTaskAccess,
  taskResourceScopePolicy,
  unassignParticipantTasks,
  validateTaskGrants,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const denied = { code: "NOT_FOUND", statusCode: 404 };
const now = new Date("2026-10-07T12:00:00Z");
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());
const service = () => createTasksService(database.db, { clock: () => now });
async function borrowerParticipant() {
  const [p] = await database.db
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.applicationId, ids.applicationSmall),
        eq(applicationParticipants.userId, ids.borrower),
      ),
    );
  if (!p) throw new Error("missing participant");
  return p;
}
async function manual(options: Record<string, unknown> = {}) {
  const before = await service().read(officer, ids.bankA, ids.applicationSmall);
  const view = await service().createManual(
    officer,
    ids.bankA,
    ids.applicationSmall,
    {
      idempotencyKey: randomUUID(),
      title: `Synthetic task ${randomUUID()}`,
      description: "Use synthetic demonstration information only.",
      assigneeParticipantId: (await borrowerParticipant()).id,
      ...options,
    },
    randomUUID(),
  );
  const task = view.tasks.find((t) => !before.tasks.some((x) => x.id === t.id));
  if (!task) throw new Error("new task missing");
  return task;
}
async function owner() {
  const userId = randomUUID(),
    participantId = randomUUID(),
    relationshipId = randomUUID();
  await database.db.insert(users).values({
    id: userId,
    email: `owner-${userId}@example.test`,
    displayName: "Synthetic owner",
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
  await database.db.insert(businessRelationships).values({
    id: relationshipId,
    bankId: ids.bankA,
    applicationId: ids.applicationSmall,
    businessId: ids.businessA,
    displayName: "Synthetic owner",
    kind: "owner",
    ownershipPercent: "25.00",
    userId,
    createdByUserId: ids.officerA,
    synthetic: true,
  });
  return { userId, participantId, relationshipId, actor: { kind: "user", userId } as Actor };
}
describe("task workflow on PostgreSQL", () => {
  it("reconciles idempotently and pins declarative product rules", async () => {
    const first = await service().read(officer, ids.bankA, ids.applicationSmall),
      second = await service().read(officer, ids.bankA, ids.applicationSmall);
    expect(first.tasks.map((x) => x.id)).toEqual(second.tasks.map((x) => x.id));
    expect(first.tasks.some((x) => x.stableKey === "industry:application")).toBe(true);
    const [policy] = await database.db
      .select()
      .from(applicationRequirementPolicies)
      .where(eq(applicationRequirementPolicies.applicationId, ids.applicationSmall));
    if (!policy) throw new Error("policy missing");
    await database.db
      .update(productRequirementRules)
      .set({ rules: [] })
      .where(eq(productRequirementRules.id, policy.ruleSetId));
    const stillPinned = await service().read(officer, ids.bankA, ids.applicationSmall);
    expect(stillPinned.tasks.map((x) => x.id)).toEqual(first.tasks.map((x) => x.id));
    await database.db
      .update(productRequirementRules)
      .set({ rules: demoRequirementRules("business-credit") })
      .where(eq(productRequirementRules.id, policy.ruleSetId));
  });
  it("persists a second sample product policy with a different checklist", async () => {
    const id = randomUUID();
    await database.db.insert(loanProducts).values({
      id,
      bankId: ids.bankA,
      slug: "equipment-finance",
      name: "Synthetic equipment finance",
      minimumAmount: "1",
      maximumAmount: "99999999",
      synthetic: true,
    });
    const appId = randomUUID();
    await database.db.insert(applications).values({
      id: appId,
      bankId: ids.bankA,
      productId: id,
      businessName: "Synthetic Equipment LLC",
      requestedAmount: "1000",
      source: "staff",
      synthetic: true,
    });
    const view = await service().read(officer, ids.bankA, appId);
    expect(view.tasks.some((x) => x.stableKey === "equipment-description:application")).toBe(true);
    expect(view.tasks.some((x) => x.stableKey === "use-of-funds:application")).toBe(true);
  });
  it("performs manual create, borrower submit, return, resubmit and staff completion", async () => {
    const task = await manual({ dueAt: "2026-11-01T12:00:00.000Z" });
    expect(task.dueAt).toBe("2026-11-01T12:00:00.000Z");
    let detail = await service().saveAnswer(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "Synthetic initial evidence" },
      randomUUID(),
    );
    expect(detail.state).toBe("open");
    await expect(
      service().review(
        officer,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: detail.revision, decision: "completed", reason: "Synthetic review" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    detail = await service().submit(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    detail = await service().review(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      {
        expectedRevision: detail.revision,
        decision: "needs_changes",
        reason: "Add one synthetic detail",
      },
      randomUUID(),
    );
    expect(detail.state).toBe("needs_changes");
    detail = await service().saveAnswer(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision, answer: "Synthetic revised evidence" },
      randomUUID(),
    );
    detail = await service().submit(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    detail = await service().review(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      {
        expectedRevision: detail.revision,
        decision: "completed",
        reason: "Synthetic evidence accepted",
      },
      randomUUID(),
    );
    expect(detail).toMatchObject({ state: "completed", evidenceRevision: 2 });
    expect(detail.answers).toHaveLength(2);
    expect(detail.reviews).toHaveLength(2);
    const progress = (await service().read(borrower, ids.bankA, ids.applicationSmall)).progress;
    detail = await service().saveAnswer(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision, answer: "Synthetic material change" },
      randomUUID(),
    );
    expect(detail.state).toBe("open");
    expect(detail.reviews).toHaveLength(2);
    expect(
      (await service().read(borrower, ids.bankA, ids.applicationSmall)).progress.completed,
    ).toBe(progress.completed - 1);
  });
  it("rejects stale concurrent submissions and reviews", async () => {
    const task = await manual();
    let detail = await service().saveAnswer(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "Synthetic evidence" },
      randomUUID(),
    );
    const submits = await Promise.allSettled(
      [1, 2].map(() =>
        service().submit(
          borrower,
          ids.bankA,
          ids.applicationSmall,
          task.id,
          { expectedRevision: detail.revision },
          randomUUID(),
        ),
      ),
    );
    expect(submits.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(submits.find((x) => x.status === "rejected")).toMatchObject({
      reason: { code: "REVISION_CONFLICT" },
    });
    detail = await service().detail(officer, ids.bankA, ids.applicationSmall, task.id);
    const reviews = await Promise.allSettled(
      ["completed", "needs_changes"].map((decision) =>
        service().review(
          officer,
          ids.bankA,
          ids.applicationSmall,
          task.id,
          { expectedRevision: detail.revision, decision, reason: "Synthetic concurrent review" },
          randomUUID(),
        ),
      ),
    );
    expect(reviews.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(reviews.find((x) => x.status === "rejected")).toMatchObject({
      reason: { code: "REVISION_CONFLICT" },
    });
  });
  it("requires waiver reasons and scopes waivers to the current occurrence", async () => {
    await database.db
      .update(applications)
      .set({ requestedAmount: "150000", revision: 10 })
      .where(eq(applications.id, ids.applicationSmall));
    let view = await service().read(officer, ids.bankA, ids.applicationSmall);
    const task = view.tasks.find(
      (x) => x.stableKey === "use-of-funds:application" && x.state !== "cancelled",
    );
    if (!task) throw new Error("amount rule missing");
    await expect(
      service().waive(
        officer,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: task.revision, reason: "" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await service().waive(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, reason: "Synthetic demonstration exception" },
      randomUUID(),
    );
    await database.db
      .update(applications)
      .set({ requestedAmount: "10000", revision: 11 })
      .where(eq(applications.id, ids.applicationSmall));
    await service().read(officer, ids.bankA, ids.applicationSmall);
    await database.db
      .update(applications)
      .set({ requestedAmount: "150000", revision: 12 })
      .where(eq(applications.id, ids.applicationSmall));
    view = await service().read(officer, ids.bankA, ids.applicationSmall);
    const active = view.tasks.find(
      (x) => x.stableKey === task.stableKey && x.state !== "cancelled",
    );
    expect(active).toMatchObject({ occurrence: 2, state: "open", evidenceRevision: 0 });
    expect(active?.id).not.toBe(task.id);
    const old = await service().detail(officer, ids.bankA, ids.applicationSmall, task.id);
    expect(old.state).toBe("cancelled");
    expect(old.reviews[0]?.decision).toBe("waived");
    await database.db
      .update(applications)
      .set({ requestedAmount: "200000", revision: 13 })
      .where(eq(applications.id, ids.applicationSmall));
    view = await service().read(officer, ids.bankA, ids.applicationSmall);
    expect(
      view.tasks.find((x) => x.stableKey === task.stableKey && x.state !== "cancelled"),
    ).toMatchObject({ occurrence: 3, state: "open" });
  });
  it("conceals private owner tasks, evidence and counts from other owners and full administrators", async () => {
    const one = await owner(),
      two = await owner();
    await service().read(officer, ids.bankA, ids.applicationSmall);
    const v1 = await service().read(one.actor, ids.bankA, ids.applicationSmall),
      v2 = await service().read(two.actor, ids.bankA, ids.applicationSmall);
    expect(v1.tasks).toHaveLength(3);
    expect(v1.tasks.every((task) => task.subjectUserId === one.userId)).toBe(true);
    expect(v1.progress.total).toBe(3);
    expect(v2.tasks).toHaveLength(3);
    expect(v2.tasks.every((task) => task.subjectUserId === two.userId)).toBe(true);
    expect(v1.tasks[0]?.id).not.toBe(v2.tasks[0]?.id);
    const task = v1.tasks.find((task) => task.stableKey.startsWith("owner-confirmation:"));
    if (!task) throw new Error("owner task missing");
    await expect(
      service().detail(two.actor, ids.bankA, ids.applicationSmall, task.id),
    ).rejects.toMatchObject(denied);
    await expect(
      service().detail(borrower, ids.bankA, ids.applicationSmall, task.id),
    ).rejects.toMatchObject(denied);
    await expect(
      service().saveAnswer(
        one.actor,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: task.revision, answer: "raw identifier forbidden" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const detail = await service().saveAnswer(
      one.actor,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "confirmed" },
      randomUUID(),
    );
    expect(detail.answer).toBe("confirmed");
    await expect(
      requireTaskAccess(
        database.db,
        two.actor,
        { bankId: ids.bankA, applicationId: ids.applicationSmall, resourceId: task.id },
        taskResourceScopePolicy(database.db),
      ),
    ).rejects.toMatchObject(denied);
  });
  it("renews a removed/re-added owner occurrence without reusing answers or waiver", async () => {
    const person = await owner();
    const task = (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (task) => task.stableKey.startsWith("owner-confirmation:") && task.state !== "cancelled",
    );
    if (!task) throw new Error("owner task missing");
    let detail = await service().saveAnswer(
      person.actor,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "confirmed" },
      randomUUID(),
    );
    detail = await service().waive(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision, reason: "Synthetic owner exception" },
      randomUUID(),
    );
    await database.db
      .update(businessRelationships)
      .set({ removedAt: now })
      .where(eq(businessRelationships.id, person.relationshipId));
    await service().read(officer, ids.bankA, ids.applicationSmall);
    await database.db
      .update(businessRelationships)
      .set({ removedAt: null })
      .where(eq(businessRelationships.id, person.relationshipId));
    const current = (
      await service().read(person.actor, ids.bankA, ids.applicationSmall)
    ).tasks.find((x) => x.stableKey === task.stableKey && x.state !== "cancelled");
    expect(current).toMatchObject({
      stableKey: task.stableKey,
      occurrence: 2,
      evidenceRevision: 0,
      state: "open",
    });
    expect(
      (await service().detail(officer, ids.bankA, ids.applicationSmall, task.id)).answers,
    ).toHaveLength(1);
  });
  it("unassigns unfinished work on removal and does not restore assignment on reinvite", async () => {
    const person = await owner();
    const task = (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (task) => task.stableKey.startsWith("owner-confirmation:") && task.state !== "cancelled",
    );
    if (!task) throw new Error("owner task missing");
    const detail = await service().saveAnswer(
      person.actor,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "confirmed" },
      randomUUID(),
    );
    await database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, ids.applicationSmall))
        .for("update");
      await tx
        .update(applicationParticipants)
        .set({ revokedAt: now, unassignedAt: now, taskIds: [] })
        .where(eq(applicationParticipants.id, person.participantId));
      await unassignParticipantTasks(
        tx,
        ids.bankA,
        ids.applicationSmall,
        person.participantId,
        ids.officerA,
        randomUUID(),
        now,
      );
    });
    await expect(
      service().detail(person.actor, ids.bankA, ids.applicationSmall, task.id),
    ).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null, unassignedAt: null })
      .where(eq(applicationParticipants.id, person.participantId));
    await database.db.transaction((tx) =>
      reconcileTasks(tx, ids.bankA, ids.applicationSmall, randomUUID(), now),
    );
    const after = await service().detail(officer, ids.bankA, ids.applicationSmall, task.id);
    expect(after.assigneeParticipantId).toBeNull();
    expect(after.answers[0]?.authorUserId).toBe(person.userId);
    expect(after.revision).toBe(detail.revision + 1);
    expect(
      (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks,
    ).toHaveLength(0);
  });
  it("accepts a fresh assignment in the current lifecycle even with an unchanged injected clock", async () => {
    const person = await owner();
    const task = (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (task) => task.stableKey.startsWith("owner-confirmation:") && task.state !== "cancelled",
    );
    if (!task) throw new Error("owner task missing");
    await database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, ids.applicationSmall))
        .for("update");
      await tx
        .update(applicationParticipants)
        .set({ revokedAt: now, unassignedAt: now, taskIds: [] })
        .where(eq(applicationParticipants.id, person.participantId));
      await unassignParticipantTasks(
        tx,
        ids.bankA,
        ids.applicationSmall,
        person.participantId,
        ids.officerA,
        randomUUID(),
        now,
      );
    });
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, person.participantId));
    expect(
      (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks,
    ).toHaveLength(0);
    const unassigned = await service().detail(officer, ids.bankA, ids.applicationSmall, task.id);
    const reassigned = await service().assign(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: unassigned.revision, participantId: person.participantId },
      randomUUID(),
    );
    const current = await service().detail(person.actor, ids.bankA, ids.applicationSmall, task.id);
    expect(current.canEdit).toBe(true);
    expect(
      (
        await service().saveAnswer(
          person.actor,
          ids.bankA,
          ids.applicationSmall,
          task.id,
          { expectedRevision: reassigned.revision, answer: "confirmed" },
          randomUUID(),
        )
      ).answer,
    ).toBe("confirmed");
  });
  it("validates delegated task grants against current bank/application and private recipient", async () => {
    const person = await owner();
    const task = (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (task) => task.stableKey.startsWith("owner-confirmation:") && task.state !== "cancelled",
    );
    if (!task) throw new Error("owner task missing");
    await expect(
      database.db.transaction((tx) =>
        validateTaskGrants(
          tx,
          officer,
          { kind: "staff", role: "officer" },
          ids.bankA,
          ids.applicationSmall,
          [task.id],
          "borrower@example.test",
        ),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      database.db.transaction((tx) =>
        validateTaskGrants(
          tx,
          officer,
          { kind: "staff", role: "officer" },
          ids.bankA,
          ids.applicationLarge,
          [task.id],
        ),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      service().read({ kind: "user", userId: ids.officerB }, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject(denied);
    await expect(
      service().saveAnswer(
        officer,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: task.revision, answer: "confirmed" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("blocks identifier text and material edits outside collection stages", async () => {
    const view = await service().read(borrower, ids.bankA, ids.applicationSmall);
    const tax = view.tasks.find(
      (task) =>
        task.stableKey === "tax-document-readiness:application" && task.state !== "cancelled",
    );
    if (!tax) throw new Error("identifier readiness task missing");
    await expect(
      service().saveAnswer(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        tax.id,
        { expectedRevision: tax.revision, answer: "arbitrary identifier text" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const task = await manual();
    const closingTask = await manual({ stage: "closing" });
    for (const status of ["submitted", "in_review", "approved"] as const) {
      await database.db
        .update(applications)
        .set({ status })
        .where(eq(applications.id, ids.applicationSmall));
      expect(
        (await service().detail(borrower, ids.bankA, ids.applicationSmall, task.id)).canEdit,
      ).toBe(false);
      await expect(
        service().saveAnswer(
          borrower,
          ids.bankA,
          ids.applicationSmall,
          task.id,
          { expectedRevision: task.revision, answer: "Synthetic evidence" },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    await database.db
      .update(applications)
      .set({ status: "closing" })
      .where(eq(applications.id, ids.applicationSmall));
    await expect(
      service().saveAnswer(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: task.revision, answer: "Synthetic evidence" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      (
        await service().saveAnswer(
          borrower,
          ids.bankA,
          ids.applicationSmall,
          closingTask.id,
          { expectedRevision: closingTask.revision, answer: "Synthetic closing evidence" },
          randomUUID(),
        )
      ).state,
    ).toBe("open");
    await database.db
      .update(applications)
      .set({ status: "collecting_information" })
      .where(eq(applications.id, ids.applicationSmall));
  });
  it("preserves completed work and authorship when a participant is removed", async () => {
    const person = await owner();
    const task = (await service().read(person.actor, ids.bankA, ids.applicationSmall)).tasks.find(
      (task) => task.stableKey.startsWith("owner-confirmation:") && task.state !== "cancelled",
    );
    if (!task) throw new Error("owner task missing");
    let detail = await service().saveAnswer(
      person.actor,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: task.revision, answer: "confirmed" },
      randomUUID(),
    );
    detail = await service().submit(
      person.actor,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    detail = await service().review(
      officer,
      ids.bankA,
      ids.applicationSmall,
      task.id,
      {
        expectedRevision: detail.revision,
        decision: "completed",
        reason: "Synthetic review complete",
      },
      randomUUID(),
    );
    await database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, ids.applicationSmall))
        .for("update");
      await tx
        .update(applicationParticipants)
        .set({ revokedAt: now, unassignedAt: now, taskIds: [] })
        .where(eq(applicationParticipants.id, person.participantId));
      await unassignParticipantTasks(
        tx,
        ids.bankA,
        ids.applicationSmall,
        person.participantId,
        ids.officerA,
        randomUUID(),
        now,
      );
    });
    const after = await service().detail(officer, ids.bankA, ids.applicationSmall, task.id);
    expect(after).toMatchObject({
      state: "completed",
      revision: detail.revision,
      assigneeParticipantId: person.participantId,
    });
    expect(after.answers[0]?.authorUserId).toBe(person.userId);
    await expect(
      service().detail(person.actor, ids.bankA, ids.applicationSmall, task.id),
    ).rejects.toMatchObject(denied);
  });
  it("enforces composite assignment constraints and audits safe metadata", async () => {
    const task = await manual();
    const [other] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.applicationId, ids.applicationLarge));
    if (!other) throw new Error("other participant missing");
    await expect(
      service().assign(
        officer,
        ids.bankA,
        ids.applicationSmall,
        task.id,
        { expectedRevision: task.revision, participantId: other.id },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      database.db
        .update(applicationTasks)
        .set({ assigneeParticipantId: other.id })
        .where(eq(applicationTasks.id, task.id)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const audits = await database.pool.query(
      "SELECT metadata FROM audit_events WHERE target_type = 'task'",
    );
    expect(JSON.stringify(audits.rows)).not.toContain("Synthetic initial evidence");
    expect(audits.rowCount).toBeGreaterThan(0);
  });
});
