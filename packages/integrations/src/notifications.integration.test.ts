import { randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantActivity,
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  notifications,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  createEnrichmentService,
  createIdentifierCipher,
  createIdentityService,
  createNotificationsService,
  createTasksService,
  queueApplicationStatusNotifications,
  recordApplicantActivity,
} from "@keycade/domain";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processAccessDelivery } from "./access-delivery.js";
import { renderAccessEmail } from "./mailpit.js";
import { dispatchNotifications, scheduleApplicationReminders } from "./notification-jobs.js";
import { type Clock } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let now = new Date("2026-10-07T12:00:00Z");
const clock: Clock = { now: () => now, sleep: async () => {} };
const origin = "http://localhost:3000";
const createdApps: string[] = [];
const identity = () => createIdentityService(database.db, { clock: () => now });
const service = () => createNotificationsService(database.db, { clock: () => now });
const officer: Actor = { kind: "user", userId: ids.officerA };
const schedule = () =>
  scheduleApplicationReminders(database.db, { clock, firstDelayMs: 1000, secondDelayMs: 3000 });
const dispatch = () => dispatchNotifications(database.db, { clock, borrowerOrigin: origin });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  await database.db.update(applications).set({ status: "withdrawn" });
}, 30000);
beforeEach(() => {
  now = new Date("2026-10-07T12:00:00Z");
});
afterEach(async () => {
  if (createdApps.length)
    await database.db
      .update(applications)
      .set({ status: "withdrawn" })
      .where(inArray(applications.id, createdApps.splice(0)));
});
afterAll(async () => database?.cleanup());
async function fixture(verified = true, complete = false) {
  const id = randomUUID(),
    email = `synthetic-${id}@example.test`;
  await database.db.insert(users).values({
    id,
    email,
    displayName: "Synthetic applicant",
    emailVerifiedAt: verified ? now : null,
    synthetic: true,
  });
  const [contact] = await database.db
    .insert(applicantContacts)
    .values({
      bankId: ids.bankA,
      email,
      userId: id,
      synthetic: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!contact) throw new Error("Missing contact.");
  const [app] = await database.db
    .insert(applications)
    .values({
      bankId: ids.bankA,
      source: "seed",
      status: complete ? "collecting_information" : "draft",
      contactId: contact.id,
      createdByUserId: id,
      synthetic: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!app) throw new Error("Missing application.");
  createdApps.push(app.id);
  const [participant] = await database.db
    .insert(applicationParticipants)
    .values({
      bankId: ids.bankA,
      applicationId: app.id,
      userId: id,
      role: "applicant_admin",
      scope: "full",
    })
    .returning();
  if (!participant) throw new Error("Missing participant.");
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: app.id,
    currentStep: complete ? "review" : "purpose",
    completedSteps: ["business_name", "product", "amount"],
    completedAt: complete ? now : null,
    completedByUserId: complete ? id : null,
  });
  await database.db.transaction((tx) => recordApplicantActivity(tx, ids.bankA, app.id, id, now));
  return { id, email, app, participant, contact, actor: { kind: "user", userId: id } as Actor };
}
async function notification(appId: string) {
  const [n] = await database.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.applicationId, appId), eq(notifications.kind, "reminder")));
  if (!n) throw new Error("Missing reminder.");
  return n;
}
async function due(f: Awaited<ReturnType<typeof fixture>>) {
  now = new Date(now.getTime() + 1001);
  await schedule();
  await dispatch();
  const n = await notification(f.app.id);
  if (!n.deliveryRequestId) throw new Error("Missing delivery.");
  return { notification: n, deliveryId: n.deliveryRequestId };
}
const consume = (url: string) =>
  identity().consumeAccessLink({
    token: new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "",
    origin,
    requestId: randomUUID(),
    rateLimitKey: randomUUID(),
  });
describe("typed notifications and inactivity reminders on PostgreSQL", () => {
  it("allows verified active participants without contacts to manage only their own preference", async () => {
    const f = await fixture(),
      userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `synthetic-owner-${userId}@example.test`,
      displayName: "Synthetic owner",
      emailVerifiedAt: now,
      synthetic: true,
    });
    const [participant] = await database.db
      .insert(applicationParticipants)
      .values({
        bankId: ids.bankA,
        applicationId: f.app.id,
        userId,
        role: "owner",
        scope: "assigned",
      })
      .returning();
    if (!participant) throw new Error("Missing owner.");
    const actor: Actor = { kind: "user", userId };
    expect(await service().preferences(actor, ids.bankA)).toEqual({ remindersEnabled: true });
    await service().setPreferences(actor, ids.bankA, { remindersEnabled: false });
    expect(await service().preferences(actor, ids.bankA)).toEqual({ remindersEnabled: false });
    expect(await service().preferences(f.actor, ids.bankA)).toEqual({ remindersEnabled: true });
    await expect(
      service().setPreferences(actor, ids.bankA, { remindersEnabled: false, userId: f.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await database.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    await expect(service().preferences(actor, ids.bankA)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await database.db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, userId));
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, participant.id));
    await expect(service().preferences(actor, ids.bankA)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("suppresses old reminders after secure identifier and tax authorization saves but ignores staff activity", async () => {
    const f = await fixture(true, true),
      queued = await due(f);
    const enrichment = createEnrichmentService(database.db, {
      cipher: createIdentifierCipher("c".repeat(64)),
      clock: () => now,
    });
    const saved = await enrichment.saveIdentifier(
      f.actor,
      ids.bankA,
      f.app.id,
      { expectedRevision: 0, value: "000000001" },
      randomUUID(),
    );
    const [afterIdentifier] = await database.db
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, f.app.id));
    expect(afterIdentifier?.episodeId).not.toBe(queued.notification.episodeId);
    expect(await identity().prepareDelivery(queued.deliveryId)).toBeNull();
    expect((await notification(f.app.id)).suppressionReason).toBe("activity_resumed");
    now = new Date(now.getTime() + 100);
    const authorized = await enrichment.authorizeTax(
      f.actor,
      ids.bankA,
      f.app.id,
      { expectedRevision: saved.revision, authorized: true, noticeVersion: "demo-tax-v1" },
      randomUUID(),
    );
    const [afterConsent] = await database.db
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, f.app.id));
    expect(afterConsent?.episodeId).not.toBe(afterIdentifier?.episodeId);
    await enrichment.saveIdentifier(
      officer,
      ids.bankA,
      f.app.id,
      { expectedRevision: authorized.revision, value: "000000002" },
      randomUUID(),
    );
    const [afterStaff] = await database.db
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, f.app.id));
    expect(afterStaff?.episodeId).toBe(afterConsent?.episodeId);
  });
  it("queues assigned and returned task notices transactionally and suppresses an obsolete assignment", async () => {
    const f = await fixture(true, true),
      tasks = createTasksService(database.db, { clock: () => now });
    const input = {
      idempotencyKey: randomUUID(),
      title: "Synthetic notification task",
      description: "Synthetic private task description is not included in mail",
      assigneeParticipantId: f.participant.id,
    };
    const view = await tasks.createManual(officer, ids.bankA, f.app.id, input, randomUUID());
    const task = view.tasks.find((t) => t.title === input.title);
    if (!task) throw new Error("Missing task.");
    await tasks.createManual(officer, ids.bankA, f.app.id, input, randomUUID());
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.applicationId, f.app.id), eq(notifications.kind, "task_assigned")),
        ),
    ).toHaveLength(1);
    const answered = await tasks.saveAnswer(
      f.actor,
      ids.bankA,
      f.app.id,
      task.id,
      { expectedRevision: task.revision, answer: "Synthetic answer" },
      randomUUID(),
    );
    const submitted = await tasks.submit(
      f.actor,
      ids.bankA,
      f.app.id,
      task.id,
      { expectedRevision: answered.revision },
      randomUUID(),
    );
    await tasks.review(
      officer,
      ids.bankA,
      f.app.id,
      task.id,
      {
        expectedRevision: submitted.revision,
        decision: "needs_changes",
        reason: "Synthetic review request",
      },
      randomUUID(),
    );
    await dispatch();
    const notices = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.applicationId, f.app.id));
    expect(notices.find((n) => n.kind === "task_assigned")).toMatchObject({
      state: "suppressed",
      suppressionReason: "task_changed",
    });
    const returned = notices.find((n) => n.kind === "task_returned");
    expect(returned?.state).toBe("queued");
    if (!returned?.deliveryRequestId) throw new Error("Missing returned task notice.");
    const prepared = await identity().prepareDelivery(returned.deliveryRequestId);
    if (!prepared) throw new Error("Missing prepared task notice.");
    const rendered = renderAccessEmail(prepared);
    expect(rendered.subject).toContain("A task needs your attention");
    expect(rendered.text).not.toContain(input.description);
    expect(rendered.text).not.toContain("Synthetic answer");
  });
  it("deduplicates status-change intents and suppresses a superseded status revision", async () => {
    const f = await fixture(true, true);
    const change = (revision: number) =>
      database.db.transaction(async (tx) => {
        await tx
          .update(applications)
          .set({ status: "needs_information", revision })
          .where(eq(applications.id, f.app.id));
        await queueApplicationStatusNotifications(tx, ids.bankA, f.app.id, revision, now);
      });
    await change(2);
    await change(2);
    await change(3);
    await dispatch();
    const notices = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.applicationId, f.app.id));
    expect(notices).toHaveLength(2);
    expect(notices.find((n) => n.resourceRevision === 2)).toMatchObject({
      state: "suppressed",
      suppressionReason: "status_changed_again",
    });
    expect(notices.find((n) => n.resourceRevision === 3)?.state).toBe("queued");
  });
  it("hides and rejects retries once the failed reminder is no longer eligible", async () => {
    const f = await fixture(),
      queued = await due(f);
    await database.db
      .update(accessDeliveryRequests)
      .set({ status: "failed", attempts: 3, lastErrorCode: "smtp_unavailable" })
      .where(eq(accessDeliveryRequests.id, queued.deliveryId));
    expect((await service().list(officer, ids.bankA, f.app.id)).notifications[0]?.canRetry).toBe(
      true,
    );
    await database.db.transaction((tx) =>
      recordApplicantActivity(tx, ids.bankA, f.app.id, f.id, now),
    );
    expect((await service().list(officer, ids.bankA, f.app.id)).notifications[0]?.canRetry).toBe(
      false,
    );
    await expect(
      service().retry(officer, ids.bankA, f.app.id, queued.notification.id, randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetId, queued.notification.id),
            eq(auditEvents.action, "notification.retry"),
          ),
        ),
    ).toHaveLength(0);
  });
  it("deduplicates both thresholds, caps an inactivity episode at two, and starts a new episode on activity", async () => {
    const f = await fixture();
    await schedule();
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.applicationId, f.app.id)),
    ).toHaveLength(0);
    now = new Date(now.getTime() + 1000);
    await Promise.all([schedule(), schedule()]);
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.applicationId, f.app.id)),
    ).toHaveLength(1);
    now = new Date(now.getTime() + 2000);
    await schedule();
    await schedule();
    const firstEpisode = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.applicationId, f.app.id));
    expect(firstEpisode.map((n) => n.reminderOrdinal).sort()).toEqual([1, 2]);
    now = new Date(now.getTime() + 100000);
    await schedule();
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.applicationId, f.app.id)),
    ).toHaveLength(2);
    await database.db.transaction((tx) =>
      recordApplicantActivity(tx, ids.bankA, f.app.id, f.id, now),
    );
    now = new Date(now.getTime() + 1000);
    await schedule();
    const all = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.applicationId, f.app.id));
    expect(all).toHaveLength(3);
    expect(new Set(all.map((n) => n.episodeId)).size).toBe(2);
  });
  it("suppresses a queued reminder after meaningful applicant activity resumes", async () => {
    const f = await fixture(),
      queued = await due(f);
    await database.db.transaction((tx) =>
      recordApplicantActivity(tx, ids.bankA, f.app.id, f.id, now),
    );
    const send = vi.fn();
    await processAccessDelivery(database.db, queued.deliveryId, { send }, { clock, delayMs: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await notification(f.app.id)).toMatchObject({
      state: "suppressed",
      suppressionReason: "activity_resumed",
    });
  });
  it("suppresses reminders after submission, withdrawal, decline, or funding", async () => {
    for (const status of ["submitted", "withdrawn", "declined", "funded"] as const) {
      const f = await fixture(),
        queued = await due(f);
      await database.db.update(applications).set({ status }).where(eq(applications.id, f.app.id));
      const send = vi.fn();
      await processAccessDelivery(database.db, queued.deliveryId, { send }, { clock, delayMs: 0 });
      expect(send).not.toHaveBeenCalled();
      expect((await notification(f.app.id)).suppressionReason).toBe("application_advanced");
    }
  });
  it("rechecks revocation after scheduling and never creates a delivery for the revoked recipient", async () => {
    const f = await fixture();
    now = new Date(now.getTime() + 1001);
    await schedule();
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now, unassignedAt: now })
      .where(eq(applicationParticipants.id, f.participant.id));
    await dispatch();
    expect(await notification(f.app.id)).toMatchObject({
      state: "suppressed",
      suppressionReason: "access_removed",
      deliveryRequestId: null,
    });
  });
  it("honors reminder opt-out without suppressing explicitly requested sign-in links", async () => {
    const f = await fixture();
    await service().setPreferences(f.actor, ids.bankA, { remindersEnabled: false });
    now = new Date(now.getTime() + 1001);
    await schedule();
    await dispatch();
    expect((await notification(f.app.id)).suppressionReason).toBe("reminders_disabled");
    await identity().requestAccessLink({
      email: f.email,
      bankSlug: "bank-a",
      portal: "borrower",
      returnPath: "/",
      origin,
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    });
    const [delivery] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.contactId, f.contact.id));
    if (!delivery) throw new Error("Missing requested access delivery.");
    expect(await identity().prepareDelivery(delivery.id)).toMatchObject({
      to: f.email,
      notification: { kind: "access_requested" },
    });
  });
  it("sends unsolicited reminders only to currently verified recipients", async () => {
    const f = await fixture(false);
    now = new Date(now.getTime() + 1001);
    await schedule();
    await dispatch();
    expect((await notification(f.app.id)).suppressionReason).toBe("recipient_unverified");
    await identity().requestAccessLink({
      email: f.email,
      bankSlug: "bank-a",
      portal: "borrower",
      returnPath: "/",
      origin,
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    });
    const [delivery] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.contactId, f.contact.id));
    if (!delivery) throw new Error("Missing access delivery.");
    expect((await identity().prepareDelivery(delivery.id))?.to).toBe(f.email);
  });
  it("does not send to a stale contact email after queue dispatch", async () => {
    const f = await fixture(),
      queued = await due(f);
    await database.db
      .update(users)
      .set({ email: `changed-${randomUUID()}@example.test` })
      .where(eq(users.id, f.id));
    const send = vi.fn();
    await processAccessDelivery(database.db, queued.deliveryId, { send }, { clock, delayMs: 0 });
    expect(send).not.toHaveBeenCalled();
    expect((await notification(f.app.id)).suppressionReason).toBe("recipient_changed");
  });
  it("rechecks identity ownership after the configured delivery delay", async () => {
    const f = await fixture(),
      queued = await due(f),
      send = vi.fn();
    await processAccessDelivery(
      database.db,
      queued.deliveryId,
      { send },
      {
        clock: {
          now: () => now,
          sleep: async () => {
            await database.db
              .update(applicantContacts)
              .set({ userId: ids.borrower })
              .where(eq(applicantContacts.id, f.contact.id));
          },
        },
        delayMs: 1,
      },
    );
    expect(send).not.toHaveBeenCalled();
    expect((await notification(f.app.id)).suppressionReason).toBe("recipient_changed");
  });
  it("resolves the saved setup destination when consuming the reminder and preserves one application", async () => {
    const f = await fixture(),
      queued = await due(f);
    const prepared = await identity().prepareDelivery(queued.deliveryId);
    if (!prepared) throw new Error("Missing prepared reminder.");
    const email = renderAccessEmail(prepared);
    expect(prepared.notification.kind).toBe("reminder");
    expect(email.subject).toContain(f.app.id.slice(-8));
    expect(email.text).toContain(prepared.confirmUrl);
    expect(email.text).toContain("turn off application reminders");
    expect(email.text).toContain("synthetic");
    expect(email.text).not.toContain(f.email);
    const before = await database.db.select({ id: applications.id }).from(applications);
    expect((await consume(prepared.confirmUrl)).returnPath).toBe(`/applications/${f.app.id}/setup`);
    expect(await database.db.select({ id: applications.id }).from(applications)).toHaveLength(
      before.length,
    );
    expect(
      (
        await database.db
          .select()
          .from(applicationSetups)
          .where(eq(applicationSetups.applicationId, f.app.id))
      )[0]?.currentStep,
    ).toBe("purpose");
  });
  it("opens current remaining work when an old reminder is consumed after setup completion", async () => {
    const f = await fixture(),
      queued = await due(f);
    const prepared = await identity().prepareDelivery(queued.deliveryId);
    if (!prepared) throw new Error("Missing prepared reminder.");
    await database.db
      .update(applicationSetups)
      .set({ completedAt: now, completedByUserId: f.id })
      .where(eq(applicationSetups.applicationId, f.app.id));
    await database.db
      .update(applications)
      .set({ status: "collecting_information" })
      .where(eq(applications.id, f.app.id));
    expect((await consume(prepared.confirmUrl)).returnPath).toBe(`/applications/${f.app.id}`);
  });
  it("exposes exhausted delivery failures to staff and retries with the same stable message ID", async () => {
    const f = await fixture(),
      queued = await due(f),
      send = vi.fn().mockRejectedValue(new Error("synthetic smtp failure"));
    for (let attempt = 0; attempt < 3; attempt++) {
      await processAccessDelivery(database.db, queued.deliveryId, { send }, { clock, delayMs: 0 });
      now = new Date(now.getTime() + 10000);
    }
    const view = await service().list(officer, ids.bankA, f.app.id);
    expect(view.notifications[0]).toMatchObject({ status: "failed", attempts: 3, canRetry: true });
    expect(new Set(send.mock.calls.map((call) => call[0].messageId)).size).toBe(1);
    const retryRequestId = randomUUID();
    await service().retry(officer, ids.bankA, f.app.id, queued.notification.id, retryRequestId);
    const retryAudit = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, queued.notification.id),
          eq(auditEvents.action, "notification.retry"),
        ),
      );
    expect(retryAudit).toHaveLength(1);
    expect(retryAudit[0]).toMatchObject({
      actorUserId: ids.officerA,
      bankId: ids.bankA,
      applicationId: f.app.id,
      requestId: retryRequestId,
      metadata: { simulated: true },
    });
    const successful = vi.fn();
    await processAccessDelivery(
      database.db,
      queued.deliveryId,
      { send: successful },
      { clock, delayMs: 0 },
    );
    expect(successful).toHaveBeenCalledOnce();
    expect((await service().list(officer, ids.bankA, f.app.id)).notifications[0]?.status).toBe(
      "delivered",
    );
    expect(successful.mock.calls[0]?.[0].messageId).toBe(send.mock.calls[0]?.[0].messageId);
  });
  it("isolates staff operations, own preferences, and activity from unauthorized participants", async () => {
    const f = await fixture();
    await expect(service().list(f.actor, ids.bankA, f.app.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      service().list({ kind: "user", userId: ids.officerB }, ids.bankA, f.app.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service().setPreferences(f.actor, ids.bankB, { remindersEnabled: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [before] = await database.db
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, f.app.id));
    await database.db.transaction((tx) =>
      recordApplicantActivity(tx, ids.bankA, f.app.id, ids.adviser, new Date(now.getTime() + 1000)),
    );
    const [after] = await database.db
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, f.app.id));
    expect(after?.episodeId).toBe(before?.episodeId);
  });
});
