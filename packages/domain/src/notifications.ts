import { randomUUID } from "node:crypto";
import { notificationPreferenceSchema, notificationsViewSchema } from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applications,
  auditEvents,
  type Database,
  notificationPreferences,
  notifications,
  users,
} from "@keycade/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { type Actor, requireApplicationAccess, requireBankStaff } from "./authorization.js";
import { DomainError, deny } from "./errors.js";
import { notificationSuppression, requestedAccessKinds } from "./notification-access.js";

export function createNotificationsService(db: Database, options: { clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => new Date());
  async function preferenceAccess(actor: Actor, bankId: string) {
    if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
    const [contact] = await db
      .select()
      .from(applicantContacts)
      .where(and(eq(applicantContacts.bankId, bankId), eq(applicantContacts.userId, actor.userId)));
    if (!contact) {
      const [participant] = await db
        .select({ id: applicationParticipants.id })
        .from(applicationParticipants)
        .innerJoin(users, eq(users.id, applicationParticipants.userId))
        .where(
          and(
            eq(applicationParticipants.bankId, bankId),
            eq(applicationParticipants.userId, actor.userId),
            isNull(applicationParticipants.revokedAt),
            isNotNull(users.emailVerifiedAt),
          ),
        )
        .limit(1);
      if (!participant) await requireBankStaff(db, actor, bankId);
    }
    return actor.userId;
  }
  async function preferences(actor: Actor, bankId: string) {
    const userId = await preferenceAccess(actor, bankId);
    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(eq(notificationPreferences.bankId, bankId), eq(notificationPreferences.userId, userId)),
      );
    return notificationPreferenceSchema.parse({ remindersEnabled: row?.remindersEnabled ?? true });
  }
  async function setPreferences(actor: Actor, bankId: string, input: unknown) {
    const userId = await preferenceAccess(actor, bankId);
    const parsed = notificationPreferenceSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError("INVALID_INPUT", 400, "Invalid notification preference.");
    await db
      .insert(notificationPreferences)
      .values({ bankId, userId, ...parsed.data, updatedAt: clock() })
      .onConflictDoUpdate({
        target: [notificationPreferences.bankId, notificationPreferences.userId],
        set: { ...parsed.data, updatedAt: clock() },
      });
    return parsed.data;
  }
  async function list(actor: Actor, bankId: string, applicationId: string) {
    await requireBankStaff(db, actor, bankId);
    await requireApplicationAccess(db, actor, bankId, applicationId);
    const rows = await db
      .select({ notification: notifications, delivery: accessDeliveryRequests })
      .from(notifications)
      .leftJoin(
        accessDeliveryRequests,
        eq(accessDeliveryRequests.id, notifications.deliveryRequestId),
      )
      .where(and(eq(notifications.bankId, bankId), eq(notifications.applicationId, applicationId)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(100);
    return notificationsViewSchema.parse({
      simulation: true,
      notifications: await Promise.all(
        rows.map(async ({ notification: n, delivery: d }) => ({
          id: n.id,
          kind: n.kind,
          status: n.state === "suppressed" ? "suppressed" : (d?.status ?? n.state),
          attempts: d?.attempts ?? 0,
          lastErrorCode: d?.lastErrorCode ?? null,
          suppressionReason: n.suppressionReason,
          createdAt: n.createdAt.toISOString(),
          deliveredAt: d?.deliveredAt?.toISOString() ?? null,
          canRetry:
            n.state === "queued" &&
            d?.status === "failed" &&
            !d.consumedAt &&
            !d.revokedAt &&
            !requestedAccessKinds.has(n.kind) &&
            (await notificationSuppression(db, n, clock())) === null,
          simulated: true,
        })),
      ),
    });
  }
  async function retry(
    actor: Actor,
    bankId: string,
    applicationId: string,
    notificationId: string,
    requestId: string = randomUUID(),
  ) {
    if (actor.kind !== "user") return deny();
    await db.transaction(async (tx) => {
      await requireBankStaff(tx, actor, bankId);
      const [app] = await tx
        .select()
        .from(applications)
        .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
        .for("update");
      if (!app) return deny();
      const [n] = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.bankId, bankId),
            eq(notifications.applicationId, applicationId),
            eq(notifications.id, notificationId),
          ),
        );
      if (!n || !n.deliveryRequestId || requestedAccessKinds.has(n.kind)) return deny();
      const now = clock();
      const [d] = await tx
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.id, n.deliveryRequestId))
        .for("update");
      if (
        !d ||
        d.status !== "failed" ||
        d.consumedAt ||
        d.revokedAt ||
        (await notificationSuppression(tx, n, now))
      )
        throw new DomainError(
          "INVALID_STATE",
          409,
          "This notification is no longer eligible for delivery.",
        );
      await tx
        .update(accessDeliveryRequests)
        .set({
          status: "queued",
          attempts: 0,
          availableAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          dispatchedAt: null,
          claimToken: null,
          leaseUntil: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(accessDeliveryRequests.id, d.id));
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: actor.userId,
        action: "notification.retry",
        targetType: "notification",
        targetId: n.id,
        requestId,
        changedFields: ["deliveryStatus"],
        metadata: { simulated: true },
        createdAt: now,
      });
    });
    return list(actor, bankId, applicationId);
  }
  return { preferences, setPreferences, list, retry };
}

/** Current participant check for continuation links, independent of setup completion. */
export async function notificationParticipantPresent(
  db: Pick<Database, "select">,
  bankId: string,
  applicationId: string,
  userId: string,
) {
  const [participant] = await db
    .select({ id: applicationParticipants.id })
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
        eq(applicationParticipants.userId, userId),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  return !!participant;
}
