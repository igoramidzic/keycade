import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationSetups,
  applications,
  auditEvents,
  bankMemberships,
  banks,
  type Database,
  type DatabaseTransaction,
  identityRateLimits,
  loginTokens,
  type NotificationKind,
  notifications,
  sessions,
  users,
} from "@keycade/db";
import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { claimApplicationInTransaction } from "./application-claims.js";
import { DomainError, deny } from "./errors.js";
import { notificationSuppression, requestedAccessKinds } from "./notification-access.js";
import { recordApplicantActivity } from "./notification-intents.js";
import { notificationParticipantPresent } from "./notifications.js";

export type IdentityPortal = "borrower" | "staff";
export type IdentitySession = {
  id: string;
  user: { id: string; email: string; displayName: string };
  bank: { id: string; slug: string; name: string };
  portal: IdentityPortal;
  authenticationMethod: "email_link" | "demo";
  csrfToken: string;
  expiresAt: string;
  staffRole: "officer" | "admin" | null;
  actor: { kind: "user"; userId: string; demoBankId?: string };
};
export type RequestAccessLinkInput = {
  email: string;
  bankSlug: string;
  portal: IdentityPortal;
  returnPath: string;
  origin: string;
  requestId: string;
  rateLimitKey: string;
};
export type PreparedAccessDelivery = {
  requestId: string;
  deliveryRequestId: string;
  claimToken: string;
  to: string;
  confirmUrl: string;
  messageId: string;
  attempt: number;
  notification: { kind: NotificationKind; applicationReference: string | null };
};

const accepted = { status: "accepted" as const };
const minute = 60_000;
export function hashIdentityCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function csrfForSession(token: string) {
  return hashIdentityCredential(`keycade-csrf:${token}`);
}
function credential() {
  return Buffer.from(randomBytes(32)).toString("hex");
}
function invalidLink(): never {
  throw new DomainError(
    "INVALID_ACCESS_LINK",
    400,
    "This link is expired or has already been used.",
  );
}
export function normalizeIdentityEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  return normalized;
}
export function normalizeIdentityReturnPath(path: string): string {
  return path === "/" ||
    /^\/(?:invitations|signatures|applications)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/setup)?$/.test(
      path,
    )
    ? path
    : "/";
}
function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  }
}

export function createIdentityService(
  db: Database,
  options: {
    clock?: () => Date;
    linkTtlMs?: number;
    sessionTtlMs?: number;
    deliveryLeaseMs?: number;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const linkTtlMs = options.linkTtlMs ?? 15 * minute;
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * minute;
  const deliveryLeaseMs = options.deliveryLeaseMs ?? minute;

  async function throttle(
    tx: DatabaseTransaction,
    keys: { key: string; limit: number }[],
    now: Date,
  ) {
    let allowed = true;
    // Consistent lock order prevents deadlocks across different email/IP combinations.
    for (const { key, limit } of keys.sort((a, b) => a.key.localeCompare(b.key))) {
      const resetAt = new Date(now.getTime() + 15 * minute);
      const [counter] = await tx
        .insert(identityRateLimits)
        .values({ keyHash: hashIdentityCredential(key), count: 1, resetAt })
        .onConflictDoUpdate({
          target: identityRateLimits.keyHash,
          set: {
            count: sql`CASE WHEN ${identityRateLimits.resetAt} <= ${now} THEN 1 ELSE ${identityRateLimits.count} + 1 END`,
            resetAt: sql`CASE WHEN ${identityRateLimits.resetAt} <= ${now} THEN ${resetAt} ELSE ${identityRateLimits.resetAt} END`,
          },
        })
        .returning();
      if (!counter || counter.count > limit) allowed = false;
    }
    return allowed;
  }

  async function requestAccessLink(input: RequestAccessLinkInput) {
    const email = normalizeIdentityEmail(input.email);
    const origin = normalizeOrigin(input.origin);
    const returnPath = normalizeIdentityReturnPath(input.returnPath);
    if (
      !["borrower", "staff"].includes(input.portal) ||
      input.bankSlug.length > 100 ||
      !input.rateLimitKey
    )
      throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
    return db.transaction(async (tx) => {
      const now = clock();
      const allowed = await throttle(
        tx,
        [
          { key: `send-email:${input.bankSlug}:${email}`, limit: 5 },
          { key: `send-ip:${input.rateLimitKey}`, limit: 20 },
        ],
        now,
      );
      if (!allowed) return accepted;
      const [bank] = await tx.select().from(banks).where(eq(banks.slug, input.bankSlug));
      if (!bank) return accepted;
      const [contact] = await tx
        .insert(applicantContacts)
        .values({
          bankId: bank.id,
          email,
          synthetic: bank.synthetic,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [applicantContacts.bankId, applicantContacts.email],
          set: { updatedAt: now },
        })
        .returning();
      if (!contact) throw new Error("Contact creation failed.");
      const [delivery] = await tx
        .insert(accessDeliveryRequests)
        .values({
          bankId: bank.id,
          contactId: contact.id,
          portal: input.portal,
          origin,
          returnPath,
          expiresAt: new Date(now.getTime() + 60 * minute),
          requestId: input.requestId,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!delivery) throw new Error("Access delivery creation failed.");
      await tx.insert(auditEvents).values({
        bankId: bank.id,
        actorType: "system",
        action: "identity.access_requested",
        targetType: "access_delivery",
        targetId: delivery.id,
        requestId: input.requestId,
        metadata: { portal: input.portal },
        createdAt: now,
      });
      return accepted;
    });
  }

  async function prepareDelivery(id: string): Promise<PreparedAccessDelivery | null> {
    return db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.id, id))
        .for("update");
      const now = clock();
      if (
        !delivery ||
        delivery.consumedAt ||
        delivery.revokedAt ||
        delivery.status === "delivered" ||
        delivery.status === "failed" ||
        delivery.availableAt > now ||
        (delivery.leaseUntil && delivery.leaseUntil > now)
      )
        return null;
      if (delivery.expiresAt <= now) {
        await tx
          .update(accessDeliveryRequests)
          .set({
            status: "failed",
            claimToken: null,
            leaseUntil: null,
            revokedAt: now,
            lastErrorCode: "DELIVERY_EXPIRED",
            updatedAt: now,
          })
          .where(eq(accessDeliveryRequests.id, id));
        return null;
      }
      if (delivery.attempts >= 3) {
        await tx
          .update(accessDeliveryRequests)
          .set({
            status: "failed",
            claimToken: null,
            leaseUntil: null,
            lastErrorCode: "DELIVERY_ATTEMPTS_EXHAUSTED",
            updatedAt: now,
          })
          .where(eq(accessDeliveryRequests.id, id));
        return null;
      }
      const [contact] = await tx
        .select()
        .from(applicantContacts)
        .where(
          and(
            eq(applicantContacts.id, delivery.contactId),
            eq(applicantContacts.bankId, delivery.bankId),
          ),
        );
      if (!contact) throw new Error("Access delivery contact unavailable.");
      let [notification] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.deliveryRequestId, delivery.id));
      if (!notification) {
        const [application] = delivery.applicationId
          ? await tx.select().from(applications).where(eq(applications.id, delivery.applicationId))
          : [];
        [notification] = await tx
          .insert(notifications)
          .values({
            bankId: delivery.bankId,
            applicationId: delivery.applicationId,
            contactId: contact.id,
            kind: delivery.invitationId
              ? "invitation"
              : application
                ? application.createdAt.getTime() === delivery.createdAt.getTime()
                  ? "application_started"
                  : "application_resume"
                : "access_requested",
            deduplicationKey: `access:${delivery.id}`,
            state: "queued",
            deliveryRequestId: delivery.id,
            availableAt: delivery.availableAt,
            createdAt: delivery.createdAt,
          })
          .onConflictDoNothing()
          .returning();
      }
      if (!notification) throw new Error("Notification record unavailable.");
      const suppression = await notificationSuppression(tx, notification, now);
      if (suppression) {
        await suppressDelivery(tx, delivery.id, notification.id, suppression, now);
        return null;
      }
      const token = credential();
      const claimToken = randomUUID();
      await tx.insert(loginTokens).values({
        deliveryRequestId: id,
        tokenHash: hashIdentityCredential(token),
        expiresAt: new Date(now.getTime() + linkTtlMs),
        createdAt: now,
      });
      await tx
        .update(accessDeliveryRequests)
        .set({
          status: "sending",
          attempts: delivery.attempts + 1,
          claimToken,
          leaseUntil: new Date(now.getTime() + deliveryLeaseMs),
          updatedAt: now,
        })
        .where(eq(accessDeliveryRequests.id, id));
      return {
        requestId: id,
        deliveryRequestId: id,
        claimToken,
        to: contact.email,
        confirmUrl: `${delivery.origin}/auth/confirm#token=${token}`,
        messageId: `<keycade-access-${id}@keycade.local>`,
        attempt: delivery.attempts + 1,
        notification: {
          kind: notification.kind,
          applicationReference: delivery.applicationId?.slice(-8) ?? null,
        },
      };
    });
  }

  async function suppressDelivery(
    tx: DatabaseTransaction,
    deliveryId: string,
    notificationId: string,
    reason: string,
    now: Date,
  ) {
    await tx
      .update(notifications)
      .set({ state: "suppressed", suppressedAt: now, suppressionReason: reason })
      .where(eq(notifications.id, notificationId));
    await tx
      .update(accessDeliveryRequests)
      .set({
        status: "failed",
        revokedAt: now,
        claimToken: null,
        leaseUntil: null,
        lastErrorCode: "NOTIFICATION_SUPPRESSED",
        updatedAt: now,
      })
      .where(eq(accessDeliveryRequests.id, deliveryId));
  }
  async function deliveryStillEligible(id: string, claimToken: string) {
    return db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(accessDeliveryRequests)
        .where(
          and(eq(accessDeliveryRequests.id, id), eq(accessDeliveryRequests.claimToken, claimToken)),
        )
        .for("update");
      if (!delivery || delivery.status !== "sending" || delivery.revokedAt || delivery.consumedAt)
        return false;
      const [notification] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.deliveryRequestId, id));
      if (!notification) return false;
      const now = clock();
      const reason =
        delivery.expiresAt <= now
          ? "delivery_expired"
          : await notificationSuppression(tx, notification, now);
      if (reason) {
        await suppressDelivery(tx, id, notification.id, reason, now);
        return false;
      }
      return true;
    });
  }

  async function completeDelivery(id: string, claimToken: string): Promise<void> {
    await db.transaction(async (tx) => {
      const now = clock();
      const [delivery] = await tx
        .update(accessDeliveryRequests)
        .set({
          status: "delivered",
          deliveredAt: now,
          claimToken: null,
          leaseUntil: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(accessDeliveryRequests.id, id),
            eq(accessDeliveryRequests.claimToken, claimToken),
            eq(accessDeliveryRequests.status, "sending"),
          ),
        )
        .returning();
      if (delivery)
        await tx.insert(auditEvents).values({
          bankId: delivery.bankId,
          actorType: "system",
          action: "identity.access_delivered",
          targetType: "access_delivery",
          targetId: id,
          requestId: delivery.requestId,
          metadata: { attempt: delivery.attempts },
          createdAt: now,
        });
    });
  }

  async function failDelivery(id: string, claimToken: string, _errorCode?: string): Promise<void> {
    // Never persist exception messages or caller strings: SMTP errors can contain the bearer link.
    await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(accessDeliveryRequests)
        .where(
          and(
            eq(accessDeliveryRequests.id, id),
            eq(accessDeliveryRequests.claimToken, claimToken),
            eq(accessDeliveryRequests.status, "sending"),
          ),
        )
        .for("update");
      if (!delivery) return;
      const now = clock();
      const failed = delivery.attempts >= 3;
      await tx
        .update(accessDeliveryRequests)
        .set({
          status: failed ? "failed" : "queued",
          claimToken: null,
          leaseUntil: null,
          dispatchedAt: null,
          availableAt: new Date(now.getTime() + 1000 * 2 ** (delivery.attempts - 1)),
          lastErrorCode: "LOCAL_EMAIL_DELIVERY_FAILED",
          updatedAt: now,
        })
        .where(eq(accessDeliveryRequests.id, id));
      await tx.insert(auditEvents).values({
        bankId: delivery.bankId,
        actorType: "system",
        action: failed ? "identity.delivery_failed" : "identity.delivery_retry_scheduled",
        targetType: "access_delivery",
        targetId: id,
        requestId: delivery.requestId,
        metadata: { attempt: delivery.attempts },
        createdAt: now,
      });
    });
  }

  async function resolveSession(raw: string, origin: string): Promise<IdentitySession | null> {
    if (!/^[a-f0-9]{64}$/.test(raw)) return null;
    const [record] = await db
      .select({ session: sessions, user: users, bank: banks })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(banks, eq(banks.id, sessions.bankId))
      .where(
        and(
          eq(sessions.tokenHash, hashIdentityCredential(raw)),
          eq(sessions.origin, origin),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, clock()),
          or(
            and(eq(sessions.authenticationMethod, "email_link"), isNotNull(users.emailVerifiedAt)),
            and(
              eq(sessions.authenticationMethod, "demo"),
              eq(banks.synthetic, true),
              eq(users.synthetic, true),
            ),
          ),
        ),
      );
    if (!record) return null;
    const [membership] = await db
      .select({ role: bankMemberships.role })
      .from(bankMemberships)
      .where(
        and(
          eq(bankMemberships.bankId, record.bank.id),
          eq(bankMemberships.userId, record.user.id),
          isNull(bankMemberships.revokedAt),
        ),
      );
    if (record.session.portal === "staff" && !membership) return null;
    return {
      id: record.session.id,
      user: { id: record.user.id, email: record.user.email, displayName: record.user.displayName },
      bank: { id: record.bank.id, slug: record.bank.slug, name: record.bank.name },
      portal: record.session.portal,
      authenticationMethod: record.session.authenticationMethod,
      csrfToken: csrfForSession(raw),
      expiresAt: record.session.expiresAt.toISOString(),
      staffRole: membership?.role ?? null,
      actor: {
        kind: "user",
        userId: record.user.id,
        ...(record.session.authenticationMethod === "demo" ? { demoBankId: record.bank.id } : {}),
      },
    };
  }

  async function consumeAccessLink(input: {
    token: string;
    origin: string;
    requestId: string;
    rateLimitKey: string;
  }) {
    const origin = normalizeOrigin(input.origin);
    const allowed = await db.transaction((tx) =>
      throttle(tx, [{ key: `consume-ip:${input.rateLimitKey}`, limit: 30 }], clock()),
    );
    if (!allowed)
      throw new DomainError("RATE_LIMITED", 429, "Too many attempts. Please try again later.");
    if (!/^[a-f0-9]{64}$/.test(input.token)) return invalidLink();
    const result = await db.transaction(async (tx) => {
      const [token] = await tx
        .select()
        .from(loginTokens)
        .where(eq(loginTokens.tokenHash, hashIdentityCredential(input.token)));
      if (!token) return invalidLink();
      const [delivery] = await tx
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.id, token.deliveryRequestId))
        .for("update");
      const now = clock();
      if (
        !delivery ||
        delivery.origin !== origin ||
        delivery.consumedAt ||
        delivery.revokedAt ||
        delivery.expiresAt <= now ||
        token.expiresAt <= now
      )
        return invalidLink();
      const [contact] = await tx
        .select()
        .from(applicantContacts)
        .where(
          and(
            eq(applicantContacts.id, delivery.contactId),
            eq(applicantContacts.bankId, delivery.bankId),
          ),
        );
      if (!contact) return invalidLink();
      const [bank] = await tx.select().from(banks).where(eq(banks.id, delivery.bankId));
      if (!bank) return invalidLink();
      const [user] = await tx
        .insert(users)
        .values({
          email: contact.email,
          displayName: "Borrower",
          emailVerifiedAt: now,
          synthetic: bank.synthetic,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})`, updatedAt: now },
        })
        .returning();
      if (!user) throw new Error("Identity binding failed.");
      const [membership] = await tx
        .select({ role: bankMemberships.role })
        .from(bankMemberships)
        .where(
          and(
            eq(bankMemberships.bankId, bank.id),
            eq(bankMemberships.userId, user.id),
            isNull(bankMemberships.revokedAt),
          ),
        )
        .for("share");
      if (delivery.portal === "staff" && !membership) return invalidLink();
      const [notification] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.deliveryRequestId, delivery.id));
      const automated = notification && !requestedAccessKinds.has(notification.kind);
      if (
        automated &&
        (notification.recipientUserId !== user.id ||
          !delivery.applicationId ||
          !(await notificationParticipantPresent(tx, bank.id, delivery.applicationId, user.id)))
      )
        return invalidLink();
      if (
        delivery.applicationId &&
        delivery.portal === "borrower" &&
        !delivery.invitationId &&
        !automated
      ) {
        await claimApplicationInTransaction(
          tx,
          { kind: "user", userId: user.id },
          bank.id,
          delivery.applicationId,
          input.requestId,
          now,
        );
      }
      await tx
        .update(applicantContacts)
        .set({ userId: user.id, updatedAt: now })
        .where(eq(applicantContacts.id, contact.id));
      await tx
        .update(accessDeliveryRequests)
        .set({ consumedAt: now, updatedAt: now })
        .where(eq(accessDeliveryRequests.id, delivery.id));
      const sessionToken = credential();
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          bankId: bank.id,
          portal: delivery.portal,
          origin,
          tokenHash: hashIdentityCredential(sessionToken),
          expiresAt: new Date(now.getTime() + sessionTtlMs),
          createdAt: now,
        })
        .returning();
      if (!session) throw new Error("Session creation failed.");
      await tx.insert(auditEvents).values({
        bankId: bank.id,
        actorType: "user",
        actorUserId: user.id,
        action: "identity.session_created",
        targetType: "session",
        targetId: session.id,
        requestId: input.requestId,
        metadata: { portal: delivery.portal },
        createdAt: now,
      });
      const sessionView: IdentitySession = {
        id: session.id,
        user: { id: user.id, email: user.email, displayName: user.displayName },
        bank: { id: bank.id, slug: bank.slug, name: bank.name },
        portal: delivery.portal,
        authenticationMethod: "email_link",
        csrfToken: csrfForSession(sessionToken),
        expiresAt: session.expiresAt.toISOString(),
        staffRole: membership?.role ?? null,
        actor: { kind: "user", userId: user.id },
      };
      let returnPath = delivery.returnPath;
      if (
        delivery.applicationId &&
        !delivery.invitationId &&
        !returnPath.startsWith("/signatures/")
      ) {
        const [setup] = await tx
          .select()
          .from(applicationSetups)
          .where(eq(applicationSetups.applicationId, delivery.applicationId));
        const [application] = await tx
          .select()
          .from(applications)
          .where(eq(applications.id, delivery.applicationId));
        returnPath = `/applications/${delivery.applicationId}${!setup?.completedAt && application?.status === "draft" ? "/setup" : ""}`;
        await recordApplicantActivity(tx, bank.id, delivery.applicationId, user.id, now);
      }
      return {
        sessionToken,
        csrfToken: sessionView.csrfToken,
        returnPath,
        session: sessionView,
      };
    });
    return result;
  }

  async function revokeSession(raw: string, requestId: string = randomUUID()): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(raw)) return;
    await db.transaction(async (tx) => {
      const now = clock();
      const [session] = await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.tokenHash, hashIdentityCredential(raw)), isNull(sessions.revokedAt)))
        .returning();
      if (session)
        await tx.insert(auditEvents).values({
          bankId: session.bankId,
          actorType: "user",
          actorUserId: session.userId,
          action: "identity.session_revoked",
          targetType: "session",
          targetId: session.id,
          requestId,
          metadata: {},
          createdAt: now,
        });
    });
  }
  // Explicit demo authentication: synthetic identities only; never an email verification.
  async function signInDemo(input: RequestAccessLinkInput) {
    const email = normalizeIdentityEmail(input.email);
    const origin = normalizeOrigin(input.origin);
    if (
      !["borrower", "staff"].includes(input.portal) ||
      input.bankSlug.length > 100 ||
      !input.rateLimitKey
    )
      throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
    const allowed = await db.transaction((tx) =>
      throttle(tx, [{ key: `consume-ip:${input.rateLimitKey}`, limit: 30 }], clock()),
    );
    if (!allowed)
      throw new DomainError("RATE_LIMITED", 429, "Too many attempts. Please try again later.");
    return db.transaction(async (tx) => {
      const now = clock();
      const [bank] = await tx
        .select()
        .from(banks)
        .where(and(eq(banks.slug, input.bankSlug), eq(banks.synthetic, true)))
        .for("share");
      if (!bank) return deny();
      await tx
        .insert(users)
        .values({
          email,
          displayName: "Demo Borrower",
          synthetic: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: users.email });
      const [user] = await tx.select().from(users).where(eq(users.email, email)).for("update");
      if (!user?.synthetic) return deny();
      const [membership] = await tx
        .select({ role: bankMemberships.role })
        .from(bankMemberships)
        .where(
          and(
            eq(bankMemberships.bankId, bank.id),
            eq(bankMemberships.userId, user.id),
            isNull(bankMemberships.revokedAt),
          ),
        )
        .for("share");
      if (input.portal === "staff" && !membership) return deny();
      await tx
        .insert(applicantContacts)
        .values({
          bankId: bank.id,
          email,
          userId: user.id,
          synthetic: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [applicantContacts.bankId, applicantContacts.email],
          set: { userId: user.id, updatedAt: now },
        });
      const sessionToken = credential();
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          bankId: bank.id,
          portal: input.portal,
          authenticationMethod: "demo",
          origin,
          tokenHash: hashIdentityCredential(sessionToken),
          expiresAt: new Date(now.getTime() + sessionTtlMs),
          createdAt: now,
        })
        .returning();
      if (!session) throw new Error("Demo session creation failed.");
      await tx.insert(auditEvents).values({
        bankId: bank.id,
        actorType: "user",
        actorUserId: user.id,
        action: "identity.demo_session_created",
        targetType: "session",
        targetId: session.id,
        requestId: input.requestId,
        metadata: { portal: input.portal, simulated: true, authenticationMethod: "demo" },
        createdAt: now,
      });
      const sessionView: IdentitySession = {
        id: session.id,
        user: { id: user.id, email: user.email, displayName: user.displayName },
        bank: { id: bank.id, slug: bank.slug, name: bank.name },
        portal: input.portal,
        authenticationMethod: "demo",
        csrfToken: csrfForSession(sessionToken),
        expiresAt: session.expiresAt.toISOString(),
        staffRole: membership?.role ?? null,
        actor: { kind: "user", userId: user.id, demoBankId: bank.id },
      };
      return {
        sessionToken,
        csrfToken: sessionView.csrfToken,
        returnPath: "/",
        session: sessionView,
      };
    });
  }
  return {
    signInDemo,
    requestAccessLink,
    prepareDelivery,
    deliveryStillEligible,
    completeDelivery,
    failDelivery,
    consumeAccessLink,
    resolveSession,
    revokeSession,
  };
}
export type IdentityService = ReturnType<typeof createIdentityService>;
