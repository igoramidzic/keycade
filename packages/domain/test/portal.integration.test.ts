import { randomUUID } from "node:crypto";
import {
  applicationParticipants,
  applicationReviewEvents,
  applicationSetups,
  applications,
  applicationTasks,
  bankMemberships,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, createApplicationService } from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const now = new Date("2026-10-08T12:00:00Z");
const borrower: Actor = { kind: "user", userId: ids.borrower };
const adviser: Actor = { kind: "user", userId: ids.adviser };
const denied = { code: "NOT_FOUND", statusCode: 404 };
const portal = (id: string, actor = borrower, bankId: string = ids.bankA) =>
  createApplicationService(database.db).portal(actor, bankId, id);
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());

async function fixture() {
  const id = randomUUID();
  await database.db.insert(applications).values({
    id,
    bankId: ids.bankA,
    businessId: ids.businessA,
    businessName: "Synthetic portal business",
    productId: ids.productA,
    requestedAmount: "10000.00",
    purpose: "Private synthetic expansion purpose",
    source: "seed",
    status: "needs_information",
    synthetic: true,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    completedAt: now,
    completedByUserId: ids.borrower,
    currentStep: "review",
  });
  await database.db.insert(applicationParticipants).values([
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    },
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.adviser,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    },
  ]);
  return id;
}

describe("borrower portal projection on PostgreSQL", () => {
  it("retains repeated lifecycle events in revision order without private review fields or other applications", async () => {
    const id = await fixture();
    const hiddenTaskId = randomUUID();
    const actions = [
      "submit",
      "start_review",
      "request_information",
      "submit",
      "start_review",
      "request_information",
    ] as const;
    const statuses = [
      "submitted",
      "in_review",
      "needs_information",
      "submitted",
      "in_review",
      "needs_information",
    ] as const;
    // Identical timestamps and reverse insertion order must not scramble the lifecycle.
    await database.db.insert(applicationReviewEvents).values(
      actions
        .map((action, index) => ({
          bankId: ids.bankA,
          applicationId: id,
          action,
          fromStatus: index ? statuses[index - 1]! : "collecting_information",
          toStatus: statuses[index]!,
          applicationRevision: index + 2,
          actorUserId: ids.officerA,
          reasonCode: "private_reason",
          privateNote: "PRIVATE_REVIEW_NOTE",
          taskIds: [hiddenTaskId],
          createdAt: now,
        }))
        .reverse(),
    );
    await database.db.insert(applicationReviewEvents).values({
      bankId: ids.bankA,
      applicationId: ids.applicationLarge,
      action: "decline",
      fromStatus: "in_review",
      toStatus: "declined",
      applicationRevision: 99,
      actorUserId: ids.officerA,
      createdAt: now,
    });
    const result = await portal(id);
    expect(result.timelineEvents.map((event) => event.status)).toEqual([
      "setup_completed",
      ...statuses,
    ]);
    expect(result.timelineEvents.every((event) => event.createdAt === now.toISOString())).toBe(
      true,
    );
    for (const event of result.timelineEvents)
      expect(Object.keys(event).sort()).toEqual(["createdAt", "id", "status"]);
    for (const secret of ["PRIVATE_REVIEW_NOTE", "private_reason", hiddenTaskId, ids.officerA])
      expect(JSON.stringify(result.timelineEvents)).not.toContain(secret);
    expect((await portal(id, adviser)).timelineEvents).toEqual(result.timelineEvents);
  });

  it("projects only the actual synthetic assigned contact with current same-bank membership", async () => {
    const id = await fixture();
    expect((await portal(id)).loanOfficer).toBeNull();
    const officerId = randomUUID();
    await database.db.insert(users).values({
      id: officerId,
      displayName: "Synthetic Assigned Officer",
      email: `assigned-${officerId}@example.test`,
      synthetic: true,
    });
    await database.db
      .insert(bankMemberships)
      .values({ bankId: ids.bankA, userId: officerId, role: "officer", synthetic: true });
    await database.db
      .update(applications)
      .set({ assignedStaffId: officerId })
      .where(eq(applications.id, id));
    expect((await portal(id)).loanOfficer).toEqual({
      displayName: "Synthetic Assigned Officer",
      email: `assigned-${officerId}@example.test`,
      synthetic: true,
    });
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: now })
      .where(eq(bankMemberships.userId, officerId));
    expect((await portal(id)).loanOfficer).toBeNull();
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: null })
      .where(eq(bankMemberships.userId, officerId));
    await database.db.update(users).set({ synthetic: false }).where(eq(users.id, officerId));
    expect((await portal(id)).loanOfficer).toBeNull();
    // A staff member at a different bank cannot become this application's contact.
    await expect(
      database.db
        .update(applications)
        .set({ assignedStaffId: ids.officerB })
        .where(eq(applications.id, id)),
    ).rejects.toThrow();
  });

  it("keeps assigned projections free of hidden terms and task counts and denies access after revocation", async () => {
    const id = await fixture();
    const before = await portal(id, adviser);
    await database.db.insert(applicationTasks).values({
      bankId: ids.bankA,
      applicationId: id,
      stableKey: "private:portal-test",
      source: "manual",
      title: "PRIVATE_TASK_TITLE",
      description: "Private synthetic evidence",
      reason: "Private synthetic check",
      visibility: "private",
      subjectUserId: ids.borrower,
      inputRevision: 1,
      required: true,
      stage: "submission",
    });
    const after = await portal(id, adviser);
    expect(after).toMatchObject({
      requestedAmount: null,
      purpose: null,
      fundingPurposes: [],
      fundedAccountId: null,
    });
    expect(after.taskProgress).toEqual(before.taskProgress);
    expect(after.remainingTasks).toBe(before.remainingTasks);
    expect(JSON.stringify(after)).not.toContain("PRIVATE_TASK_TITLE");
    expect(JSON.stringify(after)).not.toContain("Private synthetic expansion purpose");
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.userId, ids.adviser));
    await expect(portal(id, adviser)).rejects.toMatchObject(denied);
    await expect(portal(id, { kind: "user", userId: ids.officerB })).rejects.toMatchObject(denied);
    await expect(portal(id, borrower, ids.bankB)).rejects.toMatchObject(denied);
    await expect(portal(ids.applicationUnshared)).rejects.toMatchObject(denied);
  });
});
