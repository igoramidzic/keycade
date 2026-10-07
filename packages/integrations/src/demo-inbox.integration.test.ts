import { randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  bankMemberships,
  demoInboxMessages,
  notifications,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  createDemoInboxCipher,
  createDemoInboxService,
  createIdentityService,
  createParticipantsService,
  queueApplicationStatusNotifications,
} from "@keycade/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processAccessDelivery } from "./access-delivery.js";
import { createDemoInboxAdapter } from "./demo-inbox.js";
import { dispatchNotifications } from "./notification-jobs.js";
import type { Clock } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let now = new Date("2026-10-07T12:00:00Z");
const clock: Clock = { now: () => now, sleep: async () => {} };
const origin = "https://synthetic-borrower.example.test";
const cipher = createDemoInboxCipher("d".repeat(64));
const identity = () => createIdentityService(database.db, { clock: () => now });
const inbox = () => createDemoInboxService(database.db, { cipher, clock: () => now });
const adapter = () => createDemoInboxAdapter(database.db, { cipher, clock });
const officer: Actor = { kind: "user", userId: ids.officerA };
const denied = { code: "NOT_FOUND", statusCode: 404 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
beforeEach(() => {
  now = new Date("2026-10-07T12:00:00Z");
});
afterAll(async () => database?.cleanup());

async function fixture() {
  const email = `synthetic-inbox-${randomUUID()}@example.test`;
  const input = {
    email,
    bankSlug: "bank-a",
    portal: "borrower" as const,
    returnPath: "/",
    origin,
    requestId: randomUUID(),
    rateLimitKey: randomUUID(),
  };
  const session = await identity().signInDemo(input);
  await identity().requestAccessLink(input);
  const [delivery] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.requestId, input.requestId));
  if (!delivery) throw new Error("Missing synthetic delivery.");
  return { email, actor: session.session.actor, session, delivery };
}
const deliver = (id: string) => processAccessDelivery(database.db, id, adapter(), { clock });
const tokenOf = (url: string) => new URL(url).hash.slice("#token=".length);
const consume = (url: string) =>
  identity().consumeAccessLink({
    token: tokenOf(url),
    origin,
    requestId: randomUUID(),
    rateLimitKey: randomUUID(),
  });
async function read(f: Awaited<ReturnType<typeof fixture>>, id = f.delivery.id) {
  return inbox().open(f.actor, ids.bankA, id);
}

describe("private hosted simulated inbox on PostgreSQL", () => {
  it("lets an unverified synthetic identity read only its own encrypted delivery and confirm once", async () => {
    const f = await fixture();
    expect((await inbox().list(f.actor, ids.bankA)).messages).toEqual([]);
    const [before] = await database.db.select().from(users).where(eq(users.id, f.actor.userId));
    expect(before?.emailVerifiedAt).toBeNull();
    await deliver(f.delivery.id);
    const list = await inbox().list(f.actor, ids.bankA);
    expect(list).toMatchObject({
      simulated: true,
      messages: [{ id: f.delivery.id, state: "available" }],
    });
    const message = await read(f);
    expect(message.confirmUrl).not.toBeNull();
    expect(message.text).toContain("No external email has been sent.");
    expect(message.text).toContain("confirmation button");
    const url = message.confirmUrl as string;
    const [stored] = await database.db
      .select()
      .from(demoInboxMessages)
      .where(eq(demoInboxMessages.deliveryRequestId, f.delivery.id));
    expect(JSON.stringify(stored)).not.toContain(tokenOf(url));
    expect(JSON.stringify(list)).not.toContain(tokenOf(url));
    expect(message.text).not.toContain(tokenOf(url));
    const confirmed = await consume(url);
    expect(confirmed.session.authenticationMethod).toBe("email_link");
    expect(confirmed.session.user.email).toBe(f.email);
    expect(await read(f)).toMatchObject({ state: "consumed", confirmUrl: null });
    expect(JSON.stringify(await read(f))).not.toContain(tokenOf(url));
    await expect(consume(url)).rejects.toMatchObject({ code: "INVALID_ACCESS_LINK" });
  });

  it("conceals another recipient's messages and denies anonymous, system and cross-bank access", async () => {
    const f = await fixture(),
      other = await fixture();
    await deliver(f.delivery.id);
    expect((await inbox().list(other.actor, ids.bankA)).messages).toEqual([]);
    for (const actor of [
      other.actor,
      officer,
      { kind: "anonymous" } as Actor,
      { kind: "system", bankId: ids.bankA, applicationIds: [], capabilities: [] } as Actor,
    ])
      await expect(inbox().open(actor, ids.bankA, f.delivery.id)).rejects.toMatchObject(denied);
    await expect(inbox().list(f.actor, ids.bankB)).rejects.toMatchObject(denied);
    await expect(inbox().open(f.actor, ids.bankB, f.delivery.id)).rejects.toMatchObject(denied);
  });

  it("keeps expired and revoked message metadata without a link or embedded token", async () => {
    const f = await fixture();
    await deliver(f.delivery.id);
    const url = (await read(f)).confirmUrl as string;
    now = new Date(now.getTime() + 16 * 60_000);
    expect(await read(f)).toMatchObject({ state: "expired", confirmUrl: null });
    expect(JSON.stringify(await read(f))).not.toContain(tokenOf(url));
    now = new Date("2026-10-07T12:01:00Z");
    await database.db
      .update(accessDeliveryRequests)
      .set({ revokedAt: now })
      .where(eq(accessDeliveryRequests.id, f.delivery.id));
    expect(await read(f)).toMatchObject({ state: "unavailable", confirmUrl: null });
    expect((await inbox().list(f.actor, ids.bankA)).messages[0]?.state).toBe("unavailable");
  });

  it("rechecks current email/contact binding and never reads nonsynthetic identities", async () => {
    const f = await fixture(),
      other = await fixture();
    await deliver(f.delivery.id);
    await database.db
      .update(applicantContacts)
      .set({ userId: other.actor.userId })
      .where(eq(applicantContacts.id, f.delivery.contactId));
    await expect(read(f)).rejects.toMatchObject(denied);
    await expect(inbox().open(other.actor, ids.bankA, f.delivery.id)).rejects.toMatchObject(denied);
    await database.db
      .update(applicantContacts)
      .set({ userId: f.actor.userId })
      .where(eq(applicantContacts.id, f.delivery.contactId));
    await database.db
      .update(users)
      .set({ email: `changed-${randomUUID()}@example.test` })
      .where(eq(users.id, f.actor.userId));
    await expect(read(f)).rejects.toMatchObject(denied);
    await database.db
      .update(users)
      .set({ email: f.email, synthetic: false })
      .where(eq(users.id, f.actor.userId));
    await expect(read(f)).rejects.toMatchObject(denied);
  });

  it("deduplicates acceptance-before-mark retries and rotates the encrypted sibling link safely", async () => {
    const f = await fixture();
    await expect(
      processAccessDelivery(database.db, f.delivery.id, adapter(), {
        clock,
        afterSend: async () => {
          throw new Error("Synthetic crash after inbox acceptance");
        },
      }),
    ).rejects.toThrow("Synthetic crash");
    const first = await read(f);
    now = new Date(now.getTime() + 61_000);
    await deliver(f.delivery.id);
    const second = await read(f);
    expect(second.confirmUrl).not.toBe(first.confirmUrl);
    expect(second.receivedAt).toBe(first.receivedAt);
    expect((await inbox().list(f.actor, ids.bankA)).messages).toHaveLength(1);
    const [stored] = await database.db
      .select()
      .from(demoInboxMessages)
      .where(eq(demoInboxMessages.deliveryRequestId, f.delivery.id));
    expect(stored?.attempt).toBe(2);
    await consume(first.confirmUrl as string);
    await expect(consume(second.confirmUrl as string)).rejects.toMatchObject({
      code: "INVALID_ACCESS_LINK",
    });
    expect(await read(f)).toMatchObject({ state: "consumed", confirmUrl: null });
  });

  it("rejects stale claims, wrong recipients and credentials outside their delivery", async () => {
    const f = await fixture(),
      other = await fixture();
    const first = await identity().prepareDelivery(f.delivery.id);
    const unrelated = await identity().prepareDelivery(other.delivery.id);
    if (!first || !unrelated) throw new Error("Missing prepared delivery.");
    await expect(adapter().send({ ...first, to: other.email })).rejects.toThrow(
      "Synthetic inbox delivery is unavailable.",
    );
    await expect(adapter().send({ ...first, confirmUrl: unrelated.confirmUrl })).rejects.toThrow(
      "Synthetic inbox delivery is unavailable.",
    );
    await expect(
      adapter().send({
        ...first,
        confirmUrl: first.confirmUrl.replace(origin, "https://other.example.test"),
      }),
    ).rejects.toThrow("Synthetic inbox delivery is unavailable.");
    now = new Date(now.getTime() + 61_000);
    const second = await identity().prepareDelivery(f.delivery.id);
    if (!second) throw new Error("Missing retry.");
    await adapter().send(second);
    await expect(adapter().send(first)).rejects.toThrow("Synthetic inbox delivery is unavailable.");
    expect((await read(f)).confirmUrl).toBe(second.confirmUrl);
  });

  it("fails safely for corrupted ciphertext without exposing stored or supplied secrets", async () => {
    const f = await fixture();
    await deliver(f.delivery.id);
    const url = (await read(f)).confirmUrl as string;
    await database.db
      .update(demoInboxMessages)
      .set({ encryptedConfirmUrl: "corrupted-synthetic-secret" })
      .where(eq(demoInboxMessages.deliveryRequestId, f.delivery.id));
    await expect(read(f)).rejects.toMatchObject({
      code: "DEMO_MESSAGE_UNAVAILABLE",
      message: "This demo message is temporarily unavailable.",
    });
    expect(JSON.stringify(await inbox().list(f.actor, ids.bankA))).not.toContain(tokenOf(url));
  });

  it("preserves saved setup continuation instead of taking the inbox reader to a stale step", async () => {
    const f = await fixture();
    const [app] = await database.db
      .insert(applications)
      .values({
        bankId: ids.bankA,
        contactId: f.delivery.contactId,
        createdByUserId: f.actor.userId,
        source: "borrower",
        status: "draft",
        synthetic: true,
      })
      .returning();
    if (!app) throw new Error("Missing app.");
    await database.db
      .insert(applicationSetups)
      .values({ bankId: ids.bankA, applicationId: app.id, currentStep: "purpose" });
    await database.db
      .update(accessDeliveryRequests)
      .set({ applicationId: app.id, returnPath: `/applications/${app.id}` })
      .where(eq(accessDeliveryRequests.id, f.delivery.id));
    await deliver(f.delivery.id);
    const confirmed = await consume((await read(f)).confirmUrl as string);
    expect(confirmed.returnPath).toBe(`/applications/${app.id}/setup`);
    const [setup] = await database.db
      .select()
      .from(applicationSetups)
      .where(eq(applicationSetups.applicationId, app.id));
    expect(setup?.currentStep).toBe("purpose");
  });

  it("delivers an invitation to an unverified intended demo identity without granting access until confirmation", async () => {
    const f = await fixture();
    const participants = createParticipantsService(database.db, {
      clock: () => now,
      borrowerOrigin: origin,
      deliveryEnabled: true,
    });
    const view = await participants.createInvitation(
      officer,
      ids.bankA,
      ids.applicationSmall,
      {
        email: f.email,
        role: "adviser",
        scope: "assigned",
        taskIds: [],
        documentIds: [],
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const invitation = view.invitations.find((i) => i.email === f.email);
    if (!invitation) throw new Error("Missing invitation.");
    const [delivery] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.invitationId, invitation.id));
    if (!delivery) throw new Error("Missing invitation delivery.");
    await deliver(delivery.id);
    const message = await read(f, delivery.id);
    expect(message).toMatchObject({ kind: "invitation", state: "available" });
    expect((await participants.readInvitation(f.actor, ids.bankA, invitation.id)).canAccept).toBe(
      false,
    );
    const confirmed = await consume(message.confirmUrl as string);
    expect(confirmed.returnPath).toBe(`/invitations/${invitation.id}`);
    await participants.acceptInvitation(
      confirmed.session.actor,
      ids.bankA,
      invitation.id,
      randomUUID(),
    );
    const [p] = await database.db
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.applicationId, ids.applicationSmall),
          eq(applicationParticipants.userId, f.actor.userId),
        ),
      );
    expect(p).toMatchObject({ role: "adviser", scope: "assigned", taskIds: [], documentIds: [] });
    expect(await read(f, delivery.id)).toMatchObject({ state: "consumed", confirmUrl: null });
  });

  it("suppresses an already-delivered contextual link when the current participant loses access", async () => {
    const f = await fixture();
    await database.db
      .update(users)
      .set({ emailVerifiedAt: now })
      .where(eq(users.id, f.actor.userId));
    const [app] = await database.db
      .insert(applications)
      .values({
        bankId: ids.bankA,
        contactId: f.delivery.contactId,
        createdByUserId: f.actor.userId,
        source: "borrower",
        status: "collecting_information",
        synthetic: true,
      })
      .returning();
    if (!app) throw new Error("Missing app.");
    const [participant] = await database.db
      .insert(applicationParticipants)
      .values({
        bankId: ids.bankA,
        applicationId: app.id,
        userId: f.actor.userId,
        role: "applicant_admin",
        scope: "full",
      })
      .returning();
    if (!participant) throw new Error("Missing participant.");
    await database.db.transaction((tx) =>
      queueApplicationStatusNotifications(tx, ids.bankA, app.id, app.revision, now),
    );
    await dispatchNotifications(database.db, { clock, borrowerOrigin: origin });
    const [notification] = await database.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.applicationId, app.id), eq(notifications.kind, "status_changed")),
      );
    if (!notification?.deliveryRequestId) throw new Error("Missing notification delivery.");
    await deliver(notification.deliveryRequestId);
    expect(await read(f, notification.deliveryRequestId)).toMatchObject({ state: "available" });
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, participant.id));
    expect(await read(f, notification.deliveryRequestId)).toMatchObject({
      state: "unavailable",
      confirmUrl: null,
    });
  });

  it("does not make a staff sign-in link usable for an identity without active bank membership", async () => {
    const f = await fixture();
    await database.db
      .update(accessDeliveryRequests)
      .set({ portal: "staff" })
      .where(eq(accessDeliveryRequests.id, f.delivery.id));
    await deliver(f.delivery.id);
    expect(await read(f)).toMatchObject({ state: "unavailable", confirmUrl: null });
    expect(
      await database.db
        .select()
        .from(bankMemberships)
        .where(eq(bankMemberships.userId, f.actor.userId)),
    ).toEqual([]);
    await expect(
      identity().signInDemo({
        email: f.email,
        bankSlug: "bank-a",
        portal: "staff",
        returnPath: "/",
        origin,
        requestId: randomUUID(),
        rateLimitKey: randomUUID(),
      }),
    ).rejects.toMatchObject(denied);
  });
});
