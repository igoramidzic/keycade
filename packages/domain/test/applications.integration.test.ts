import { randomUUID } from "node:crypto";
import { applicationParticipants, applications, auditEvents, bankMemberships } from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  readApplication,
  readStaffApplication,
  requireDocumentAccess,
  requireTaskAccess,
  updateApplicationPurpose,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officerA: Actor = { kind: "user", userId: ids.officerA };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});

describe("real PostgreSQL application boundaries", () => {
  it("allows only explicit participation, including two separately granted applications", async () => {
    for (const applicationId of [ids.applicationSmall, ids.applicationLarge]) {
      expect((await readApplication(database.db, borrower, ids.bankA, applicationId)).id).toBe(
        applicationId,
      );
    }
    await expect(
      readApplication(database.db, borrower, ids.bankA, ids.applicationUnshared),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });
  it("denies cross-bank, wrong-bank, nonexistent, revoked and anonymous access uniformly", async () => {
    const requests: [Actor, string, string][] = [
      [borrower, ids.bankB, ids.applicationOtherBank],
      [officerA, ids.bankB, ids.applicationOtherBank],
      [officerA, ids.bankA, ids.applicationOtherBank],
      [officerA, ids.bankA, randomUUID()],
      [{ kind: "user", userId: ids.revokedOwner }, ids.bankA, ids.applicationLarge],
      [{ kind: "anonymous" }, ids.bankA, ids.applicationSmall],
    ];
    for (const [actor, bankId, applicationId] of requests) {
      await expect(
        readApplication(database.db, actor, bankId, applicationId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Resource not found.",
        statusCode: 404,
      });
    }
  });
  it("does not expose staff fields to borrowers and denies the staff service directly", async () => {
    const publicData = await readApplication(
      database.db,
      borrower,
      ids.bankA,
      ids.applicationSmall,
    );
    expect(publicData).not.toHaveProperty("source");
    expect(publicData).not.toHaveProperty("contactId");
    await expect(
      readStaffApplication(database.db, borrower, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await readStaffApplication(database.db, officerA, ids.bankA, ids.applicationUnshared),
    ).toHaveProperty("source", "seed");
  });
  it("does not reuse an actor's earlier permission after staff or participant revocation", async () => {
    const adviser: Actor = { kind: "user", userId: ids.adviser };
    await readApplication(database.db, adviser, ids.bankA, ids.applicationSmall);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: new Date() })
      .where(eq(applicationParticipants.userId, ids.adviser));
    await expect(
      readApplication(database.db, adviser, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const officerB: Actor = { kind: "user", userId: ids.officerB };
    await readApplication(database.db, officerB, ids.bankB, ids.applicationOtherBank);
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: new Date() })
      .where(eq(bankMemberships.userId, ids.officerB));
    await expect(
      readApplication(database.db, officerB, ids.bankB, ids.applicationOtherBank),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("denies future resource scopes by default, including for applicant administrators and staff", async () => {
    const resource = {
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      resourceId: randomUUID(),
    };
    await expect(requireTaskAccess(database.db, borrower, resource)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(requireDocumentAccess(database.db, officerA, resource)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("limits a system actor to its explicit bank, application and capability", async () => {
    const system: Actor = {
      kind: "system",
      bankId: ids.bankA,
      applicationIds: [ids.applicationSmall],
      capabilities: ["application:read"],
    };
    expect((await readApplication(database.db, system, ids.bankA, ids.applicationSmall)).id).toBe(
      ids.applicationSmall,
    );
    await expect(
      readApplication(database.db, system, ids.bankA, ids.applicationLarge),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateApplicationPurpose(
        database.db,
        system,
        ids.bankA,
        ids.applicationSmall,
        { expectedRevision: 1, purpose: "No write capability" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("commits a revision update and safe audit together; a stale retry writes neither", async () => {
    const requestId = randomUUID();
    const updated = await updateApplicationPurpose(
      database.db,
      borrower,
      ids.bankA,
      ids.applicationSmall,
      { expectedRevision: 1, purpose: "Synthetic change with private detail excluded from audit" },
      requestId,
    );
    expect(updated.revision).toBe(2);
    const audit = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, requestId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      actorUserId: ids.borrower,
      changedFields: ["purpose"],
      metadata: {},
    });
    expect(JSON.stringify(audit)).not.toContain("private detail");
    const retryId = randomUUID();
    await expect(
      updateApplicationPurpose(
        database.db,
        borrower,
        ids.bankA,
        ids.applicationSmall,
        { expectedRevision: 1, purpose: "Stale update" },
        retryId,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.requestId, retryId)),
    ).toHaveLength(0);
    expect(
      (await readApplication(database.db, borrower, ids.bankA, ids.applicationSmall)).revision,
    ).toBe(2);
  });
  it("rolls back a state write if the audit insert fails", async () => {
    const before = await readApplication(database.db, borrower, ids.bankA, ids.applicationLarge);
    const requestId = randomUUID();
    await database.db.execute(
      sql`CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_audit()`,
    );
    try {
      await expect(
        updateApplicationPurpose(
          database.db,
          borrower,
          ids.bankA,
          ids.applicationLarge,
          { expectedRevision: before.revision, purpose: "Must rollback" },
          requestId,
        ),
      ).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER test_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION test_reject_audit()`);
    }
    expect(await readApplication(database.db, borrower, ids.bankA, ids.applicationLarge)).toEqual(
      before,
    );
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.requestId, requestId)),
    ).toHaveLength(0);
  });
  it("allows only one concurrent writer at a given revision", async () => {
    const before = await readApplication(database.db, borrower, ids.bankA, ids.applicationLarge);
    const outcomes = await Promise.allSettled([
      updateApplicationPurpose(
        database.db,
        borrower,
        ids.bankA,
        ids.applicationLarge,
        { expectedRevision: before.revision, purpose: "Writer A" },
        randomUUID(),
      ),
      updateApplicationPurpose(
        database.db,
        borrower,
        ids.bankA,
        ids.applicationLarge,
        { expectedRevision: before.revision, purpose: "Writer B" },
        randomUUID(),
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("rejects changes to submitted facts without writing a success audit", async () => {
    await database.db
      .update(applications)
      .set({ status: "submitted" })
      .where(eq(applications.id, ids.applicationLarge));
    const before = await readApplication(database.db, borrower, ids.bankA, ids.applicationLarge);
    const requestId = randomUUID();
    await expect(
      updateApplicationPurpose(
        database.db,
        borrower,
        ids.bankA,
        ids.applicationLarge,
        { expectedRevision: before.revision, purpose: "Invalid material change" },
        requestId,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.applicationId, ids.applicationLarge),
            eq(auditEvents.requestId, requestId),
          ),
        ),
    ).toHaveLength(0);
  });
});
