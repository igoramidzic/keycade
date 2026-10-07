import {
  type DemoInboxMessageSummary,
  demoInboxMessageSchema,
  demoInboxViewSchema,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applications,
  bankMemberships,
  banks,
  type Database,
  type DatabaseTransaction,
  demoInboxMessages,
  invitations,
  loginTokens,
  notifications,
  users,
} from "@keycade/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Actor } from "./authorization.js";
import type { DemoInboxCipher } from "./demo-inbox-cipher.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import { notificationSuppression } from "./notification-access.js";

type Tx = Pick<DatabaseTransaction, "select">;
type InboxRow = typeof demoInboxMessages.$inferSelect;
type Delivery = typeof accessDeliveryRequests.$inferSelect;
const unavailable = () => new Error("Synthetic inbox delivery is unavailable.");

function credentialFromUrl(url: string, origin: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== origin ||
      parsed.pathname !== "/auth/confirm" ||
      parsed.search ||
      parsed.username ||
      parsed.password ||
      !/^#token=[a-f0-9]{64}$/.test(parsed.hash)
    )
      throw new Error();
    return parsed.hash.slice("#token=".length);
  } catch {
    throw unavailable();
  }
}

/** Internal adapter boundary: recipients and credentials come from the durable delivery claim. */
export async function storeDemoInboxMessage(
  db: Database,
  input: {
    deliveryRequestId: string;
    claimToken: string;
    attempt: number;
    to: string;
    confirmUrl: string;
    subject: string;
    text: string;
  },
  options: { cipher: DemoInboxCipher; clock?: () => Date },
): Promise<void> {
  const now = options.clock?.() ?? new Date();
  await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.id, input.deliveryRequestId))
      .for("update");
    if (
      !delivery ||
      delivery.status !== "sending" ||
      delivery.claimToken !== input.claimToken ||
      delivery.attempts !== input.attempt ||
      !delivery.leaseUntil ||
      delivery.leaseUntil <= now ||
      delivery.expiresAt <= now ||
      delivery.revokedAt ||
      delivery.consumedAt
    )
      throw unavailable();
    const [bank] = await tx.select().from(banks).where(eq(banks.id, delivery.bankId));
    const [contact] = await tx
      .select()
      .from(applicantContacts)
      .where(
        and(
          eq(applicantContacts.id, delivery.contactId),
          eq(applicantContacts.bankId, delivery.bankId),
        ),
      );
    if (!bank?.synthetic || !contact?.synthetic || contact.email !== input.to) throw unavailable();
    if (contact.userId) {
      const [user] = await tx.select().from(users).where(eq(users.id, contact.userId));
      if (!user?.synthetic || user.email !== contact.email) throw unavailable();
    }
    if (delivery.applicationId) {
      const [application] = await tx
        .select({ synthetic: applications.synthetic })
        .from(applications)
        .where(
          and(
            eq(applications.id, delivery.applicationId),
            eq(applications.bankId, delivery.bankId),
          ),
        );
      if (!application?.synthetic) throw unavailable();
    }
    const [notification] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.deliveryRequestId, delivery.id));
    if (!notification || (await notificationSuppression(tx, notification, now)))
      throw unavailable();
    const token = credentialFromUrl(input.confirmUrl, delivery.origin);
    const [loginToken] = await tx
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.deliveryRequestId, delivery.id),
          eq(loginTokens.tokenHash, hashIdentityCredential(token)),
        ),
      );
    if (!loginToken || loginToken.expiresAt <= now) throw unavailable();
    if (
      input.subject.length > 240 ||
      input.text.length > 4000 ||
      input.subject.includes(token) ||
      input.text.includes(token) ||
      input.text.includes("#token=")
    )
      throw unavailable();
    const encryptedConfirmUrl = options.cipher.encrypt(input.confirmUrl, {
      bankId: delivery.bankId,
      deliveryRequestId: delivery.id,
      loginTokenId: loginToken.id,
      recipientEmail: input.to,
    });
    const values = {
      loginTokenId: loginToken.id,
      recipientEmail: input.to,
      subject: input.subject,
      text: input.text,
      encryptedConfirmUrl,
      attempt: input.attempt,
      updatedAt: now,
    };
    // A retry replaces the encrypted link with its new sibling token, keeping one inbox message.
    await tx
      .insert(demoInboxMessages)
      .values({ deliveryRequestId: delivery.id, ...values, receivedAt: now })
      .onConflictDoUpdate({ target: demoInboxMessages.deliveryRequestId, set: values });
  });
}

export function createDemoInboxService(
  db: Database,
  options: { cipher: DemoInboxCipher; clock?: () => Date },
) {
  const clock = options.clock ?? (() => new Date());

  async function recipient(tx: Tx, actor: Actor, bankId: string) {
    if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
    const [bank] = await tx.select().from(banks).where(eq(banks.id, bankId));
    const [user] = await tx.select().from(users).where(eq(users.id, actor.userId));
    if (!bank?.synthetic || !user?.synthetic) return deny();
    const [contact] = await tx
      .select()
      .from(applicantContacts)
      .where(
        and(
          eq(applicantContacts.bankId, bankId),
          eq(applicantContacts.userId, user.id),
          eq(applicantContacts.email, user.email),
          eq(applicantContacts.synthetic, true),
        ),
      );
    if (!contact) return deny();
    return { user, contact };
  }

  async function summary(
    tx: Tx,
    message: InboxRow,
    delivery: Delivery,
    token: typeof loginTokens.$inferSelect,
    user: typeof users.$inferSelect,
    now: Date,
  ): Promise<DemoInboxMessageSummary> {
    const [notification] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.deliveryRequestId, delivery.id));
    const expiresAt = new Date(Math.min(delivery.expiresAt.getTime(), token.expiresAt.getTime()));
    let state: DemoInboxMessageSummary["state"] = "available";
    if (delivery.consumedAt) state = "consumed";
    else if (expiresAt <= now) state = "expired";
    else if (
      delivery.revokedAt ||
      delivery.status === "failed" ||
      !notification ||
      (await notificationSuppression(tx, notification, now))
    )
      state = "unavailable";
    if (state === "available" && delivery.portal === "staff") {
      const [membership] = await tx
        .select({ id: bankMemberships.id })
        .from(bankMemberships)
        .where(
          and(
            eq(bankMemberships.bankId, delivery.bankId),
            eq(bankMemberships.userId, user.id),
            isNull(bankMemberships.revokedAt),
          ),
        );
      if (!membership) state = "unavailable";
    }
    if (state === "available" && delivery.invitationId) {
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(
          and(eq(invitations.id, delivery.invitationId), eq(invitations.bankId, delivery.bankId)),
        );
      if (
        !invitation?.synthetic ||
        invitation.status !== "pending" ||
        invitation.expiresAt <= now ||
        invitation.email !== user.email
      )
        state = "unavailable";
    }
    if (state === "available" && delivery.applicationId) {
      const [application] = await tx
        .select({ synthetic: applications.synthetic })
        .from(applications)
        .where(
          and(
            eq(applications.id, delivery.applicationId),
            eq(applications.bankId, delivery.bankId),
          ),
        );
      if (!application?.synthetic) state = "unavailable";
    }
    return {
      id: message.deliveryRequestId,
      subject: message.subject,
      kind: notification?.kind ?? "access_requested",
      applicationReference: delivery.applicationId?.slice(-8) ?? null,
      receivedAt: message.receivedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      state,
    };
  }

  async function list(actor: Actor, bankId: string) {
    return db.transaction(async (tx) => {
      const { contact, user } = await recipient(tx, actor, bankId);
      const rows = await tx
        .select({
          message: demoInboxMessages,
          delivery: accessDeliveryRequests,
          token: loginTokens,
        })
        .from(demoInboxMessages)
        .innerJoin(
          accessDeliveryRequests,
          eq(demoInboxMessages.deliveryRequestId, accessDeliveryRequests.id),
        )
        .innerJoin(loginTokens, eq(demoInboxMessages.loginTokenId, loginTokens.id))
        .where(
          and(
            eq(accessDeliveryRequests.bankId, bankId),
            eq(accessDeliveryRequests.contactId, contact.id),
            eq(demoInboxMessages.recipientEmail, user.email),
          ),
        )
        .orderBy(desc(demoInboxMessages.receivedAt), desc(demoInboxMessages.deliveryRequestId))
        .limit(50);
      const messages: DemoInboxMessageSummary[] = [];
      for (const row of rows)
        messages.push(await summary(tx, row.message, row.delivery, row.token, user, clock()));
      return demoInboxViewSchema.parse({ simulated: true, messages });
    });
  }

  async function open(actor: Actor, bankId: string, messageId: string) {
    return db.transaction(async (tx) => {
      const { contact, user } = await recipient(tx, actor, bankId);
      const [row] = await tx
        .select({
          message: demoInboxMessages,
          delivery: accessDeliveryRequests,
          token: loginTokens,
        })
        .from(demoInboxMessages)
        .innerJoin(
          accessDeliveryRequests,
          eq(demoInboxMessages.deliveryRequestId, accessDeliveryRequests.id),
        )
        .innerJoin(loginTokens, eq(demoInboxMessages.loginTokenId, loginTokens.id))
        .where(
          and(
            eq(demoInboxMessages.deliveryRequestId, messageId),
            eq(accessDeliveryRequests.bankId, bankId),
            eq(accessDeliveryRequests.contactId, contact.id),
            eq(demoInboxMessages.recipientEmail, user.email),
          ),
        );
      if (!row) return deny();
      const view = await summary(tx, row.message, row.delivery, row.token, user, clock());
      let confirmUrl: string | null = null;
      if (view.state === "available") {
        try {
          confirmUrl = options.cipher.decrypt(row.message.encryptedConfirmUrl, {
            bankId,
            deliveryRequestId: row.delivery.id,
            loginTokenId: row.token.id,
            recipientEmail: user.email,
          });
          const rawToken = credentialFromUrl(confirmUrl, row.delivery.origin);
          if (
            row.token.deliveryRequestId !== row.delivery.id ||
            hashIdentityCredential(rawToken) !== row.token.tokenHash
          )
            throw new Error();
        } catch {
          throw new DomainError(
            "DEMO_MESSAGE_UNAVAILABLE",
            503,
            "This demo message is temporarily unavailable.",
          );
        }
      }
      return demoInboxMessageSchema.parse({
        ...view,
        simulated: true,
        text:
          view.state === "available"
            ? row.message.text
            : row.message.text.replace(
                "Use the confirmation button below to continue.",
                "This confirmation link is no longer available.",
              ),
        confirmUrl,
      });
    });
  }
  return { list, open };
}
