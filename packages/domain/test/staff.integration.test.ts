import { randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationSetups,
  applications,
  auditEvents,
  bankMemberships,
  staffNotes,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  addStaffNote,
  assignApplicationStaff,
  createApplicationService,
  listStaffApplications,
  readApplication,
  readStaffOptions,
  readStaffWorkspace,
  updateStaffNote,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const officer: Actor = { kind: "user", userId: ids.officerA };
const borrower: Actor = { kind: "user", userId: ids.borrower };
const demo: Actor = { ...officer, demoBankId: ids.bankA };
const clock = () => new Date("2026-10-07T12:00:00.000Z");
const origin = "http://localhost:3001";
const notFound = { code: "NOT_FOUND", statusCode: 404 };
const read = (id: string) => readStaffWorkspace(database.db, officer, ids.bankA, id);
const service = () =>
  createApplicationService(database.db, { clock, staffContinuationOrigin: origin });
async function createDraft(name?: string) {
  const result = await service().create(
    officer,
    ids.bankA,
    { email: `${randomUUID()}@example.test`, idempotencyKey: randomUUID() },
    randomUUID(),
  );
  if (name)
    await service().saveSetup(
      officer,
      ids.bankA,
      result.id,
      {
        expectedRevision: result.revision,
        answers: { businessName: name },
        currentStep: "business_name",
      },
      randomUUID(),
    );
  return read(result.id);
}
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});

describe("staff queue and workspace on PostgreSQL", () => {
  it("scopes queue, counts, options, details and note mutations to current bank staff", async () => {
    const own = await listStaffApplications(database.db, officer, ids.bankA);
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((item) => item.bankId === ids.bankA)).toBe(true);
    expect(own.items.map((item) => item.id)).not.toContain(ids.applicationOtherBank);
    const options = await readStaffOptions(database.db, officer, ids.bankA);
    expect(options.products.map((item) => item.id)).toEqual([ids.productA]);
    expect(options.officers.map((item) => item.id)).toEqual([ids.officerA]);
    for (const actor of [
      borrower,
      { kind: "anonymous" } as Actor,
      { kind: "user", userId: ids.officerB } as Actor,
    ]) {
      await expect(listStaffApplications(database.db, actor, ids.bankA)).rejects.toMatchObject(
        notFound,
      );
      await expect(readStaffOptions(database.db, actor, ids.bankA)).rejects.toMatchObject(notFound);
      await expect(
        readStaffWorkspace(database.db, actor, ids.bankA, ids.applicationSmall),
      ).rejects.toMatchObject(notFound);
      await expect(
        addStaffNote(
          database.db,
          actor,
          ids.bankA,
          ids.applicationSmall,
          { expectedRevision: 1, body: "Forbidden" },
          randomUUID(),
        ),
      ).rejects.toMatchObject(notFound);
    }
    await expect(
      readStaffWorkspace(database.db, officer, ids.bankA, ids.applicationOtherBank),
    ).rejects.toMatchObject(notFound);
    await expect(listStaffApplications(database.db, officer, ids.bankB)).rejects.toMatchObject(
      notFound,
    );
    expect(
      (
        await listStaffApplications(database.db, officer, ids.bankA, {
          search: "Synthetic Birch Services",
        })
      ).total,
    ).toBe(0);
  });
  it("uses stable server pages, literal search, status/product/assignee filters and allowlisted sorting", async () => {
    const drafts = await Promise.all([
      createDraft("Queue fixture alpha"),
      createDraft("Queue fixture beta"),
      createDraft("Queue fixture 100%"),
    ]);
    const idsSorted = drafts.map((row) => row.id).sort();
    const first = await listStaffApplications(database.db, officer, ids.bankA, {
      search: "Queue fixture",
      limit: 2,
      sort: "created_asc",
      status: "draft",
      productId: ids.productA,
      assigneeId: "unassigned",
    });
    const second = await listStaffApplications(database.db, officer, ids.bankA, {
      search: "Queue fixture",
      limit: 2,
      page: 2,
      sort: "created_asc",
    });
    expect(first.total).toBe(3);
    expect(first.totalPages).toBe(2);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(idsSorted);
    expect(
      (
        await listStaffApplications(database.db, officer, ids.bankA, {
          search: "Queue fixture",
          sort: "business_asc",
        })
      ).items.map((item) => item.businessName),
    ).toEqual(["Queue fixture 100%", "Queue fixture alpha", "Queue fixture beta"]);
    expect(
      (await listStaffApplications(database.db, officer, ids.bankA, { search: "%" })).items.map(
        (item) => item.id,
      ),
    ).toEqual([drafts[2]?.id]);
    expect(
      (
        await listStaffApplications(database.db, officer, ids.bankA, {
          search: "Queue fixture",
          status: "submitted",
        })
      ).total,
    ).toBe(0);
    expect(
      (await listStaffApplications(database.db, officer, ids.bankA, { productId: ids.productB }))
        .total,
    ).toBe(0);
    await expect(
      listStaffApplications(database.db, officer, ids.bankA, { limit: 101 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      listStaffApplications(database.db, officer, ids.bankA, { sort: "purpose" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      listStaffApplications(database.db, officer, ids.bankA, { bankId: ids.bankB }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("shows borrower and staff origin, verified/pending/unverified contact and saved setup truth", async () => {
    const original = await read(ids.applicationSmall);
    expect(original.contact?.status).toBe("verified");
    expect(original.participants.some((row) => row.id === ids.borrower)).toBe(true);
    expect(original.tasks).toBeNull();
    expect(original.documents).toBeNull();
    expect(original.checks).toBeNull();
    const draft = await createDraft("Synthetic prefilled applicant");
    expect(draft).toMatchObject({
      source: "staff",
      createdBy: { id: ids.officerA },
      setupStatus: "in_progress",
      currentStep: "business_name",
      contact: { status: "pending" },
    });
    expect(draft.setup.completedSteps).toEqual([]);
    expect(draft.setup.completedAt).toBeNull();
    const intake = await service().create(
      borrower,
      ids.bankA,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect((await read(intake.id)).source).toBe("borrower");
    await database.db
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, ids.borrower));
    try {
      expect((await read(intake.id)).contact?.status).toBe("unverified");
    } finally {
      await database.db
        .update(users)
        .set({ emailVerifiedAt: clock() })
        .where(eq(users.id, ids.borrower));
    }
  });
  it("queues one safe continuation request transactionally for staff creation and keeps applicant confirmation required", async () => {
    const input = { email: `${randomUUID()}@example.test`, idempotencyKey: randomUUID() };
    const created = await service().create(officer, ids.bankA, input, randomUUID());
    const retry = await service().create(officer, ids.bankA, input, randomUUID());
    expect(retry.id).toBe(created.id);
    const delivery = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.applicationId, created.id));
    expect(delivery).toHaveLength(1);
    expect(delivery[0]).toMatchObject({ origin, portal: "borrower", returnPath: "/" });
    expect(delivery[0]).not.toHaveProperty("token");
    expect(created.setupStatus).toBe("in_progress");
    await expect(
      service().finishSetup(
        officer,
        ids.bankA,
        created.id,
        { expectedRevision: created.revision, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
  });
  it("requires continuation for staff HTTP-style creation without blocking borrower drafts", async () => {
    const unavailable = createApplicationService(database.db, {
      clock,
      requireStaffContinuation: true,
    });
    const email = `${randomUUID()}@example.test`;
    const requestId = randomUUID();
    const before = await listStaffApplications(database.db, officer, ids.bankA);
    await expect(
      unavailable.create(officer, ids.bankA, { email, idempotencyKey: randomUUID() }, requestId),
    ).rejects.toMatchObject({ code: "AUTH_DELIVERY_UNAVAILABLE", statusCode: 503 });
    expect((await listStaffApplications(database.db, officer, ids.bankA)).total).toBe(before.total);
    expect(
      await database.db.select().from(applicantContacts).where(eq(applicantContacts.email, email)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.requestId, requestId)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.requestId, requestId)),
    ).toHaveLength(0);
    const created = await unavailable.create(
      { ...borrower, demoBankId: ids.bankA },
      ids.bankA,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(created.setupStatus).toBe("in_progress");
    expect((await read(created.id)).source).toBe("borrower");
    const available = createApplicationService(database.db, {
      clock,
      requireStaffContinuation: true,
      staffContinuationOrigin: origin,
    });
    const staffCreated = await available.create(
      officer,
      ids.bankA,
      { email, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(
      await database.db
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.applicationId, staffCreated.id)),
    ).toHaveLength(1);
  });

  it("persists revision-checked assignment, rejects cross-bank/revoked officers and supports unassignment", async () => {
    const draft = await createDraft();
    for (const userId of [ids.officerB, ids.borrower])
      await expect(
        assignApplicationStaff(
          database.db,
          officer,
          ids.bankA,
          draft.id,
          { expectedRevision: draft.revision, assignedStaffId: userId },
          randomUUID(),
        ),
      ).rejects.toMatchObject(notFound);
    const [inactiveUser] = await database.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.test`,
        displayName: "Inactive synthetic officer",
        synthetic: true,
      })
      .returning();
    if (!inactiveUser) throw new Error("Expected inactive officer");
    await database.db.insert(bankMemberships).values({
      bankId: ids.bankA,
      userId: inactiveUser.id,
      role: "officer",
      revokedAt: clock(),
      synthetic: true,
    });
    await expect(
      assignApplicationStaff(
        database.db,
        officer,
        ids.bankA,
        draft.id,
        { expectedRevision: draft.revision, assignedStaffId: inactiveUser.id },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    expect(
      (await readStaffOptions(database.db, officer, ids.bankA)).officers.map((row) => row.id),
    ).not.toContain(inactiveUser.id);
    const assigned = await assignApplicationStaff(
      database.db,
      officer,
      ids.bankA,
      draft.id,
      { expectedRevision: draft.revision, assignedStaffId: ids.officerA },
      randomUUID(),
      { clock },
    );
    expect(assigned).toMatchObject({ assignedStaffId: ids.officerA, revision: draft.revision + 1 });
    expect(assigned.setup.revision).toBe(assigned.revision);
    const filtered = await listStaffApplications(database.db, officer, ids.bankA, {
      assigneeId: ids.officerA,
    });
    expect(filtered.items.map((item) => item.id)).toContain(draft.id);
    await expect(
      assignApplicationStaff(
        database.db,
        officer,
        ids.bankA,
        draft.id,
        { expectedRevision: draft.revision, assignedStaffId: null },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const cleared = await assignApplicationStaff(
      database.db,
      officer,
      ids.bankA,
      draft.id,
      { expectedRevision: assigned.revision, assignedStaffId: null },
      randomUUID(),
    );
    expect(cleared.assignedStaffId).toBeNull();
  });
  it("edits internal notes atomically, scopes note IDs and keeps content out of audits and borrower DTOs", async () => {
    const before = await read(ids.applicationSmall);
    const requestId = randomUUID();
    const added = await addStaffNote(
      database.db,
      officer,
      ids.bankA,
      before.id,
      { expectedRevision: before.revision, body: "Private synthetic staff assessment" },
      requestId,
      { clock },
    );
    const note = added.notes[0];
    if (!note) throw new Error("Expected note");
    expect(note.author.id).toBe(ids.officerA);
    const updated = await updateStaffNote(
      database.db,
      officer,
      ids.bankA,
      before.id,
      note.id,
      { expectedRevision: added.revision, body: "Revised private staff assessment" },
      randomUUID(),
      { clock },
    );
    expect(updated.notes[0]?.body).toBe("Revised private staff assessment");
    expect(await readApplication(database.db, borrower, ids.bankA, before.id)).not.toHaveProperty(
      "notes",
    );
    expect(JSON.stringify(await service().portal(borrower, ids.bankA, before.id))).not.toContain(
      "assessment",
    );
    const audit = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.applicationId, before.id), eq(auditEvents.targetType, "staff_note")),
      );
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("assessment");
    expect(audit.map((event) => event.action).sort()).toEqual([
      "staff_note.created",
      "staff_note.updated",
    ]);
    await expect(
      updateStaffNote(
        database.db,
        officer,
        ids.bankA,
        before.id,
        note.id,
        { expectedRevision: added.revision, body: "stale" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const other = await read(ids.applicationLarge);
    await expect(
      updateStaffNote(
        database.db,
        officer,
        ids.bankA,
        other.id,
        note.id,
        { expectedRevision: other.revision, body: "wrong application" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    const bankBActor: Actor = { kind: "user", userId: ids.officerB };
    await expect(
      updateStaffNote(
        database.db,
        bankBActor,
        ids.bankB,
        ids.applicationOtherBank,
        note.id,
        { expectedRevision: 1, body: "wrong bank" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
  });
  it("rolls back note, application and setup writes when audit persistence fails", async () => {
    const before = await createDraft();
    await database.db.execute(
      sql`CREATE FUNCTION test_staff_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER staff_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_staff_audit_failure()`,
    );
    try {
      await expect(
        addStaffNote(
          database.db,
          officer,
          ids.bankA,
          before.id,
          { expectedRevision: before.revision, body: "must roll back" },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await expect(
        assignApplicationStaff(
          database.db,
          officer,
          ids.bankA,
          before.id,
          { expectedRevision: before.revision, assignedStaffId: ids.officerA },
          randomUUID(),
        ),
      ).rejects.toThrow();
      const requestId = randomUUID();
      await expect(
        service().create(
          officer,
          ids.bankA,
          { email: `${randomUUID()}@example.test`, idempotencyKey: randomUUID() },
          requestId,
        ),
      ).rejects.toThrow();
      expect(
        await database.db
          .select()
          .from(accessDeliveryRequests)
          .where(eq(accessDeliveryRequests.requestId, requestId)),
      ).toHaveLength(0);
    } finally {
      await database.db.execute(sql`DROP TRIGGER staff_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION test_staff_audit_failure()`);
    }
    expect(await read(before.id)).toEqual(before);
  });
  it("serializes competing note changes at one application revision", async () => {
    const before = await createDraft();
    const outcomes = await Promise.allSettled(
      ["first", "second"].map((body) =>
        addStaffNote(
          database.db,
          officer,
          ids.bankA,
          before.id,
          { expectedRevision: before.revision, body },
          randomUUID(),
        ),
      ),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await read(before.id)).notes).toHaveLength(1);
  });
  it("enforces composite note tenant constraints and current membership revocation", async () => {
    await expect(
      database.db.insert(staffNotes).values({
        bankId: ids.bankA,
        applicationId: ids.applicationOtherBank,
        body: "Synthetic invalid link",
        authorUserId: ids.officerA,
        updatedByUserId: ids.officerA,
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(staffNotes).values({
        bankId: ids.bankA,
        applicationId: ids.applicationSmall,
        body: "Synthetic invalid author",
        authorUserId: ids.officerB,
        updatedByUserId: ids.officerA,
      }),
    ).rejects.toThrow();
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: clock() })
      .where(eq(bankMemberships.userId, ids.officerA));
    try {
      await expect(listStaffApplications(database.db, officer, ids.bankA)).rejects.toMatchObject(
        notFound,
      );
      await expect(read(ids.applicationSmall)).rejects.toMatchObject(notFound);
    } finally {
      await database.db
        .update(bankMemberships)
        .set({ revokedAt: null })
        .where(eq(bankMemberships.userId, ids.officerA));
    }
  });
  it("excludes nonsynthetic records from demo reads, counts and writes", async () => {
    const draft = await createDraft("Non-demo boundary");
    await database.db
      .update(applications)
      .set({ synthetic: false })
      .where(eq(applications.id, draft.id));
    expect(
      (await listStaffApplications(database.db, demo, ids.bankA, { search: "Non-demo boundary" }))
        .total,
    ).toBe(0);
    await expect(readStaffWorkspace(database.db, demo, ids.bankA, draft.id)).rejects.toMatchObject(
      notFound,
    );
    await expect(
      addStaffNote(
        database.db,
        demo,
        ids.bankA,
        draft.id,
        { expectedRevision: draft.revision, body: "forbidden" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    expect(
      (
        await database.db
          .select()
          .from(applicationSetups)
          .where(eq(applicationSetups.applicationId, draft.id))
      )[0]?.revision,
    ).toBe(draft.revision);
  });
});
