import {
  applicantContacts,
  applicationParticipants,
  applications,
  auditEvents,
  banks,
  type DatabaseTransaction,
  users,
} from "@keycade/db";
import { and, eq } from "drizzle-orm";
import type { Actor } from "./authorization.js";
import { deny } from "./errors.js";
import { recordApplicantActivity } from "./notification-intents.js";

/** Explicit contact-draft claim only. Never accepts an invitation or restores a revoked grant. */
export async function claimApplicationInTransaction(
  tx: DatabaseTransaction,
  actor: Actor,
  bankId: string,
  applicationId: string,
  requestId: string,
  now: Date,
) {
  if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
  const [row] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
    .for("update");
  if (!row) return deny();
  const [user] = await tx.select().from(users).where(eq(users.id, actor.userId));
  const [bank] = await tx.select().from(banks).where(eq(banks.id, bankId));
  if (
    !user ||
    !bank ||
    (actor.demoBankId
      ? !user.synthetic || !bank.synthetic || !row.synthetic
      : !user.emailVerifiedAt)
  )
    return deny();
  const [existing] = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.applicationId, applicationId),
        eq(applicationParticipants.userId, actor.userId),
      ),
    )
    .for("share");
  if (existing) {
    if (existing.revokedAt || existing.role !== "applicant_admin" || existing.scope !== "full")
      return deny();
    return;
  }
  if (row.status !== "draft" || !row.contactId || !["borrower", "staff"].includes(row.source))
    return deny();
  const [contact] = await tx
    .select()
    .from(applicantContacts)
    .where(and(eq(applicantContacts.id, row.contactId), eq(applicantContacts.bankId, bankId)));
  if (!contact || contact.email !== user.email || (actor.demoBankId && !contact.synthetic))
    return deny();
  await tx.insert(applicationParticipants).values({
    bankId,
    applicationId,
    userId: actor.userId,
    role: "applicant_admin",
    scope: "full",
    synthetic: row.synthetic,
    createdAt: now,
    updatedAt: now,
  });
  await tx
    .update(applicantContacts)
    .set({ userId: actor.userId, updatedAt: now })
    .where(eq(applicantContacts.id, contact.id));
  await recordApplicantActivity(tx, bankId, applicationId, actor.userId, now);
  await tx.insert(auditEvents).values({
    bankId,
    applicationId,
    actorType: "user",
    actorUserId: actor.userId,
    action: "application.claimed",
    targetType: "application",
    targetId: applicationId,
    requestId,
    metadata: {
      authenticationMethod: actor.demoBankId ? "demo" : "email_link",
      simulated: row.synthetic,
    },
    createdAt: now,
  });
}
