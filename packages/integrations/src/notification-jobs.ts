import {
  accessDeliveryRequests,
  applicantActivity,
  applicantContacts,
  applicationParticipants,
  applications,
  type Database,
  notifications,
  signatureNotificationOutbox,
  users,
} from "@keycade/db";
import { notificationSuppression, queueNotification } from "@keycade/domain";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { type Clock, systemClock } from "./provider.js";

export async function scheduleApplicationReminders(
  db: Database,
  options: { clock?: Clock; firstDelayMs?: number; secondDelayMs?: number } = {},
) {
  const now = (options.clock ?? systemClock).now();
  const first = options.firstDelayMs ?? 24 * 60 * 60_000;
  const second = options.secondDelayMs ?? 72 * 60 * 60_000;
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || second <= first)
    throw new Error("Invalid reminder thresholds.");
  // Existing synthetic records start conservatively at their last persisted update.
  const apps = await db
    .select()
    .from(applications)
    .where(inArray(applications.status, ["draft", "collecting_information", "needs_information"]));
  for (const app of apps)
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, app.id))
        .for("update");
      if (
        !current ||
        !["draft", "collecting_information", "needs_information"].includes(current.status)
      )
        return;
      await tx
        .insert(applicantActivity)
        .values({ bankId: app.bankId, applicationId: app.id, lastMeaningfulAt: app.updatedAt })
        .onConflictDoNothing();
      const [activity] = await tx
        .select()
        .from(applicantActivity)
        .where(eq(applicantActivity.applicationId, app.id));
      if (!activity) return;
      const elapsed = now.getTime() - activity.lastMeaningfulAt.getTime();
      const ordinal = elapsed >= second ? 2 : elapsed >= first ? 1 : null;
      if (!ordinal) return;
      const participants = await tx
        .select()
        .from(applicationParticipants)
        .where(
          and(
            eq(applicationParticipants.applicationId, app.id),
            eq(applicationParticipants.role, "applicant_admin"),
            eq(applicationParticipants.scope, "full"),
            isNull(applicationParticipants.revokedAt),
          ),
        );
      for (const person of participants)
        await queueNotification(tx, {
          bankId: app.bankId,
          applicationId: app.id,
          recipientUserId: person.userId,
          kind: "reminder",
          sourceKey: `${activity.episodeId}:${ordinal}`,
          episodeId: activity.episodeId,
          reminderOrdinal: ordinal,
          availableAt: new Date(
            activity.lastMeaningfulAt.getTime() + (ordinal === 1 ? first : second),
          ),
          now,
        });
    });
}

export async function dispatchNotifications(
  db: Database,
  options: { borrowerOrigin: string; clock?: Clock },
) {
  const clock = options.clock ?? systemClock;
  const origin = new URL(options.borrowerOrigin);
  if (
    origin.origin !== options.borrowerOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new Error("Invalid notification origin.");
  await db.transaction(async (tx) => {
    const intents = await tx
      .select()
      .from(signatureNotificationOutbox)
      .where(isNull(signatureNotificationOutbox.dispatchedAt))
      .limit(25)
      .for("update", { skipLocked: true });
    for (const intent of intents) {
      await queueNotification(tx, {
        bankId: intent.bankId,
        applicationId: intent.applicationId,
        recipientUserId: intent.recipientUserId,
        kind: "signature_requested",
        sourceKey: intent.id,
        resourceId: intent.envelopeId,
        now: intent.createdAt,
      });
      await tx
        .update(signatureNotificationOutbox)
        .set({ dispatchedAt: clock.now() })
        .where(eq(signatureNotificationOutbox.id, intent.id));
    }
  });
  return db.transaction(async (tx) => {
    const now = clock.now();
    const pending = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.state, "pending"), lte(notifications.availableAt, now)))
      .limit(25)
      .for("update", { skipLocked: true });
    for (const n of pending) {
      const reason = await notificationSuppression(tx, n, now);
      if (reason) {
        await tx
          .update(notifications)
          .set({ state: "suppressed", suppressedAt: now, suppressionReason: reason })
          .where(eq(notifications.id, n.id));
        continue;
      }
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, n.recipientUserId ?? "00000000-0000-0000-0000-000000000000"));
      if (!user || !n.applicationId) throw new Error("Eligible notification recipient missing.");
      const [contact] = await tx
        .insert(applicantContacts)
        .values({
          bankId: n.bankId,
          email: user.email,
          userId: user.id,
          synthetic: user.synthetic,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [applicantContacts.bankId, applicantContacts.email],
          set: { userId: user.id, updatedAt: now },
        })
        .returning();
      if (!contact) throw new Error("Notification contact creation failed.");
      const [delivery] = await tx
        .insert(accessDeliveryRequests)
        .values({
          bankId: n.bankId,
          applicationId: n.applicationId,
          contactId: contact.id,
          portal: "borrower",
          origin: origin.origin,
          returnPath:
            n.kind === "signature_requested"
              ? `/signatures/${n.resourceId}`
              : `/applications/${n.applicationId}`,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          requestId: n.id,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!delivery) throw new Error("Notification delivery creation failed.");
      await tx
        .update(notifications)
        .set({ state: "queued", contactId: contact.id, deliveryRequestId: delivery.id })
        .where(eq(notifications.id, n.id));
    }
    return pending.length;
  });
}
