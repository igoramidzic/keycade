import { randomUUID } from "node:crypto";
import { applicationParticipants, users } from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createParticipantsService,
  readApplication,
  requireApplicationAccess,
  updateApplicationPurpose,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const origin = "http://localhost:3001";
const denied = { code: "NOT_FOUND", statusCode: 404 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());

function harness() {
  let now = new Date("2026-10-07T12:00:00.000Z");
  const service = createParticipantsService(database.db, {
    clock: () => now,
    borrowerOrigin: origin,
    deliveryEnabled: true,
    invitationTtlMs: 60_000,
  });
  return {
    service,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}
async function recipient(verified = true) {
  const id = randomUUID();
  const email = `participants-${id}@example.test`;
  await database.db.insert(users).values({
    id,
    email,
    displayName: "Synthetic Collaborator",
    synthetic: true,
    emailVerifiedAt: verified ? new Date("2026-10-07T11:00:00Z") : null,
  });
  return { id, email, actor: { kind: "user", userId: id } as Actor };
}
function invitationInput(email: string) {
  return {
    email,
    role: "adviser" as const,
    scope: "assigned" as const,
    taskIds: [],
    documentIds: [],
    idempotencyKey: randomUUID(),
  };
}
async function invite(
  service: ReturnType<typeof harness>["service"],
  email: string,
  actor = borrower,
) {
  const input = invitationInput(email);
  const workspace = await service.createInvitation(
    actor,
    ids.bankA,
    ids.applicationSmall,
    input,
    randomUUID(),
  );
  const invitation = workspace.invitations.find((item) => item.email === email);
  if (!invitation) throw new Error("Expected synthetic invitation.");
  return { input, invitation, workspace };
}

describe("participant collaboration on PostgreSQL", () => {
  it("records ownership independently of users, invitations and portal grants", async () => {
    const { service } = harness();
    const before = await database.pool.query(
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM application_participants) AS participants",
    );
    const input = {
      displayName: `Synthetic owner ${randomUUID()}`,
      kind: "owner" as const,
      ownershipPercent: "25.50",
      idempotencyKey: randomUUID(),
    };
    const workspace = await service.addRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    expect(workspace.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: input.displayName,
          kind: "owner",
          ownershipPercent: "25.50",
        }),
      ]),
    );
    const repeated = await service.addRelationship(
      officer,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    expect(
      repeated.relationships.filter((item) => item.displayName === input.displayName),
    ).toHaveLength(1);
    const after = await database.pool.query(
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM application_participants) AS participants",
    );
    expect(after.rows).toEqual(before.rows);
    await expect(
      service.addRelationship(
        officer,
        ids.bankA,
        ids.applicationSmall,
        { ...input, ownershipPercent: "51.00" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("defaults to a restricted grant, creates one durable delivery and keeps pending invites powerless", async () => {
    const { service } = harness();
    const person = await recipient();
    const { input, invitation } = await invite(service, person.email);
    expect(invitation).toMatchObject({
      role: "adviser",
      scope: "assigned",
      status: "pending",
      taskIds: [],
      documentIds: [],
    });
    await expect(
      readApplication(database.db, person.actor, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject(denied);
    const repeated = await service.createInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    expect(repeated.invitations.filter((item) => item.id === invitation.id)).toHaveLength(1);
    await expect(
      service.createInvitation(
        borrower,
        ids.bankA,
        ids.applicationSmall,
        { ...input, email: `${randomUUID()}@example.test` },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const deliveries = await database.pool.query(
      "SELECT id, origin, return_path FROM access_delivery_requests WHERE invitation_id = $1",
      [invitation.id],
    );
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]).toMatchObject({
      origin,
      return_path: `/invitations/${invitation.id}`,
    });
    expect(
      (
        await database.pool.query("SELECT id FROM login_tokens WHERE delivery_request_id = $1", [
          deliveries.rows[0].id,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it("requires the exact verified recipient and reuses one existing identity for concurrent and replayed acceptance", async () => {
    const { service } = harness();
    const person = await recipient();
    const wrong = await recipient();
    const { invitation } = await invite(service, person.email);
    await expect(
      service.acceptInvitation(wrong.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    await expect(
      service.acceptInvitation(
        { ...person.actor, demoBankId: ids.bankA } as Actor,
        ids.bankA,
        invitation.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await database.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, person.id));
    await expect(
      service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date("2026-10-07T11:00:00Z") })
      .where(eq(users.id, person.id));
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID()),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 4 }, () => ({ applicationId: ids.applicationSmall })),
    );
    const memberships = await database.db
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.applicationId, ids.applicationSmall),
          eq(applicationParticipants.userId, person.id),
        ),
      );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "adviser", scope: "assigned", revokedAt: null });
    expect(
      await database.db.select().from(users).where(eq(users.email, person.email)),
    ).toHaveLength(1);
    const summary = await readApplication(
      database.db,
      person.actor,
      ids.bankA,
      ids.applicationSmall,
    );
    expect(summary).toMatchObject({ requestedAmount: null, purpose: null });
    for (const applicationId of [ids.applicationLarge, ids.applicationUnshared])
      await expect(
        readApplication(database.db, person.actor, ids.bankA, applicationId),
      ).rejects.toMatchObject(denied);
    await expect(
      service.acceptInvitation(person.actor, ids.bankB, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
  });

  it("expires and revokes invitations without granting access; resend and revoke are idempotent and audited", async () => {
    const { service, advance } = harness();
    const person = await recipient();
    const { invitation } = await invite(service, person.email);
    advance(60_001);
    expect(
      (await service.read(borrower, ids.bankA, ids.applicationSmall)).invitations.find(
        (row) => row.id === invitation.id,
      )?.status,
    ).toBe("expired");
    await expect(
      service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    const resend = { idempotencyKey: randomUUID() };
    await service.resendInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      invitation.id,
      resend,
      randomUUID(),
    );
    await service.resendInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      invitation.id,
      resend,
      randomUUID(),
    );
    const deliveries = await database.pool.query(
      "SELECT id FROM access_delivery_requests WHERE invitation_id = $1",
      [invitation.id],
    );
    expect(deliveries.rows).toHaveLength(2);
    const revoke = { idempotencyKey: randomUUID() };
    await service.revokeInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      invitation.id,
      revoke,
      randomUUID(),
    );
    await service.revokeInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      invitation.id,
      revoke,
      randomUUID(),
    );
    await expect(
      service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    await expect(
      readApplication(database.db, person.actor, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject(denied);
    const audit = await database.pool.query<{ action: string; metadata: object }>(
      "SELECT action, metadata FROM audit_events WHERE target_id = $1",
      [invitation.id],
    );
    expect(audit.rows.filter((row) => row.action.includes("resent"))).toHaveLength(1);
    expect(audit.rows.filter((row) => row.action.includes("revoked"))).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(person.email);
  });

  it("blocks borrower privilege escalation and restricts management to current full administrators or staff", async () => {
    const { service } = harness();
    const input = invitationInput(`${randomUUID()}@example.test`);
    for (const role of ["officer", "admin"])
      await expect(
        service.createInvitation(
          borrower,
          ids.bankA,
          ids.applicationSmall,
          { ...input, role },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    for (const role of ["owner", "adviser"] as const)
      await expect(
        service.createInvitation(
          borrower,
          ids.bankA,
          ids.applicationSmall,
          { ...input, role, scope: "full" },
          randomUUID(),
        ),
      ).rejects.toMatchObject(denied);
    for (const actor of [
      { kind: "anonymous" },
      { kind: "user", userId: ids.adviser },
      { kind: "user", userId: ids.officerB },
    ] as Actor[]) {
      await expect(
        service.createInvitation(actor, ids.bankA, ids.applicationSmall, input, randomUUID()),
      ).rejects.toMatchObject(denied);
      await expect(
        service.addRelationship(
          actor,
          ids.bankA,
          ids.applicationSmall,
          { displayName: "Forbidden", kind: "owner", idempotencyKey: randomUUID() },
          randomUUID(),
        ),
      ).rejects.toMatchObject(denied);
    }
    await expect(
      service.createInvitation(borrower, ids.bankA, ids.applicationSetupDraft, input, randomUUID()),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
  });

  it("rechecks inviter authority at acceptance after participant removal and staff revocation", async () => {
    for (const inviterKind of ["participant", "staff"] as const) {
      const { service } = harness();
      const inviter = await recipient();
      const target = await recipient();
      if (inviterKind === "participant") {
        await database.db.insert(applicationParticipants).values({
          bankId: ids.bankA,
          applicationId: ids.applicationSmall,
          userId: inviter.id,
          role: "applicant_admin",
          scope: "full",
          synthetic: true,
        });
      } else {
        await database.pool.query(
          "INSERT INTO bank_memberships (bank_id, user_id, role, synthetic) VALUES ($1,$2,'officer',true)",
          [ids.bankA, inviter.id],
        );
      }
      const { invitation } = await invite(service, target.email, inviter.actor);
      if (inviterKind === "participant") {
        await database.db
          .update(applicationParticipants)
          .set({ revokedAt: new Date() })
          .where(eq(applicationParticipants.userId, inviter.id));
      } else {
        await database.pool.query("UPDATE bank_memberships SET revoked_at=now() WHERE user_id=$1", [
          inviter.id,
        ]);
      }
      await expect(
        service.acceptInvitation(target.actor, ids.bankA, invitation.id, randomUUID()),
      ).rejects.toMatchObject(denied);
      await expect(
        requireApplicationAccess(database.db, target.actor, ids.bankA, ids.applicationSmall),
      ).rejects.toMatchObject(denied);
    }
  });

  it("removes access immediately, clears future assignments, preserves membership history, and does not revive it on replay", async () => {
    const { service } = harness();
    const person = await recipient();
    const input = {
      ...invitationInput(person.email),
      role: "applicant_admin" as const,
      scope: "full" as const,
    };
    const created = await service.createInvitation(
      officer,
      ids.bankA,
      ids.applicationSmall,
      input,
      randomUUID(),
    );
    const invitation = created.invitations.find((row) => row.email === person.email);
    if (!invitation) throw new Error("Expected invitation.");
    await service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID());
    const [participant] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.userId, person.id));
    if (!participant) throw new Error("Expected participant.");
    const summary = await readApplication(
      database.db,
      person.actor,
      ids.bankA,
      ids.applicationSmall,
    );
    const remove = { idempotencyKey: randomUUID() };
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      remove,
      randomUUID(),
    );
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      remove,
      randomUUID(),
    );
    await expect(
      readApplication(database.db, person.actor, ids.bankA, ids.applicationSmall),
    ).rejects.toMatchObject(denied);
    await expect(
      updateApplicationPurpose(
        database.db,
        person.actor,
        ids.bankA,
        ids.applicationSmall,
        { expectedRevision: summary.revision, purpose: "Forbidden stale-session write" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      service.acceptInvitation(person.actor, ids.bankA, invitation.id, randomUUID()),
    ).rejects.toMatchObject(denied);
    const [removed] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.id, participant.id));
    expect(removed?.revokedAt).toBeInstanceOf(Date);
    expect(removed?.unassignedAt).toBeInstanceOf(Date);
    expect(removed).toMatchObject({ userId: person.id, taskIds: [], documentIds: [] });
  });
  it("enforces tenant-bearing collaboration links in PostgreSQL itself", async () => {
    const { service } = harness();
    const person = await recipient();
    const { invitation } = await invite(service, person.email);
    await expect(
      database.pool.query("UPDATE invitations SET bank_id=$1 WHERE id=$2", [
        ids.bankB,
        invitation.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    const common = [ids.bankA, ids.applicationSmall, ids.businessA, ids.officerA];
    const insert =
      "INSERT INTO business_relationships (bank_id, application_id, business_id, created_by_user_id, display_name, kind) VALUES ($1,$2,$3,$4,'Synthetic tenant boundary','owner')";
    await expect(
      database.pool.query(insert, [ids.bankB, ...common.slice(1)]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database.pool.query(insert, [
        ids.bankA,
        ids.applicationOtherBank,
        ids.businessA,
        ids.officerA,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database.pool.query(insert, [
        ids.bankA,
        ids.applicationSmall,
        ids.businessOtherBank,
        ids.officerA,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    const delivery = await database.pool.query<{ id: string }>(
      "SELECT id FROM access_delivery_requests WHERE invitation_id=$1",
      [invitation.id],
    );
    await expect(
      database.pool.query("UPDATE access_delivery_requests SET bank_id=$1 WHERE id=$2", [
        ids.bankB,
        delivery.rows[0]?.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("keeps another owner's relationship and participant details out of restricted views", async () => {
    const { service } = harness();
    const owner = await recipient();
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      userId: owner.id,
      role: "owner",
      scope: "assigned",
      synthetic: true,
    });
    const ownName = `Synthetic own relationship ${randomUUID()}`;
    const otherName = `Synthetic other relationship ${randomUUID()}`;
    await database.pool.query(
      "INSERT INTO business_relationships (bank_id, application_id, business_id, created_by_user_id, user_id, display_name, kind) VALUES ($1,$2,$3,$4,$5,$6,'owner'), ($1,$2,$3,$4,NULL,$7,'owner')",
      [ids.bankA, ids.applicationSmall, ids.businessA, ids.officerA, owner.id, ownName, otherName],
    );
    const ownerView = await service.read(owner.actor, ids.bankA, ids.applicationSmall);
    expect(ownerView.canManage).toBe(false);
    expect(ownerView.participants.map((row) => row.userId)).toEqual([owner.id]);
    expect(ownerView.relationships.map((row) => row.displayName)).toEqual([ownName]);
    expect(ownerView.invitations).toEqual([]);
    const adviserView = await service.read(
      { kind: "user", userId: ids.adviser },
      ids.bankA,
      ids.applicationSmall,
    );
    expect(adviserView.relationships).toEqual([]);
    expect(adviserView.invitations).toEqual([]);
    expect(adviserView.participants.map((row) => row.userId)).toEqual([ids.adviser]);
    const managerView = await service.read(borrower, ids.bankA, ids.applicationSmall);
    expect(managerView.relationships.map((row) => row.displayName)).toEqual(
      expect.arrayContaining([ownName, otherName]),
    );
    expect(JSON.stringify(managerView)).not.toMatch(/ssn|identifier|dateOfBirth/);
  });
  it("does not expose later application changes through accepted, revoked, or expired invitation links after access ends", async () => {
    const { service, advance } = harness();
    const acceptedPerson = await recipient();
    const revokedPerson = await recipient();
    const expiredPerson = await recipient();
    const accepted = (await invite(service, acceptedPerson.email)).invitation;
    const revoked = (await invite(service, revokedPerson.email)).invitation;
    const expired = (await invite(service, expiredPerson.email)).invitation;
    const before = await database.pool.query<{ business_name: string | null }>(
      "SELECT business_name FROM applications WHERE id=$1",
      [ids.applicationSmall],
    );
    const originalName = before.rows[0]?.business_name ?? null;
    expect(await service.readInvitation(expiredPerson.actor, ids.bankA, expired.id)).toMatchObject({
      status: "pending",
      businessName: originalName,
      canAccept: true,
    });
    await service.acceptInvitation(acceptedPerson.actor, ids.bankA, accepted.id, randomUUID());
    expect(
      await service.readInvitation(acceptedPerson.actor, ids.bankA, accepted.id),
    ).toMatchObject({
      status: "accepted",
      businessName: originalName,
    });
    const [participant] = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.userId, acceptedPerson.id));
    if (!participant) throw new Error("Expected accepted participant.");
    await service.removeParticipant(
      officer,
      ids.bankA,
      ids.applicationSmall,
      participant.id,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    await service.revokeInvitation(
      borrower,
      ids.bankA,
      ids.applicationSmall,
      revoked.id,
      { idempotencyKey: randomUUID() },
      randomUUID(),
    );
    advance(60_001);
    const laterName = `Synthetic confidential later edit ${randomUUID()}`;
    try {
      await database.pool.query("UPDATE applications SET business_name=$1 WHERE id=$2", [
        laterName,
        ids.applicationSmall,
      ]);
      await expect(
        service.readInvitation(acceptedPerson.actor, ids.bankA, accepted.id),
      ).rejects.toMatchObject(denied);
      for (const [person, invitation, status] of [
        [revokedPerson, revoked, "revoked"],
        [expiredPerson, expired, "expired"],
      ] as const) {
        const preview = await service.readInvitation(person.actor, ids.bankA, invitation.id);
        expect(preview).toMatchObject({ status, businessName: null, canAccept: false });
        expect(JSON.stringify(preview)).not.toContain(laterName);
      }
    } finally {
      await database.pool.query("UPDATE applications SET business_name=$1 WHERE id=$2", [
        originalName,
        ids.applicationSmall,
      ]);
    }
  });
});
