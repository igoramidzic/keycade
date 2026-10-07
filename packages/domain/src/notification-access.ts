import {
  applicantActivity,
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  type DatabaseTransaction,
  notificationPreferences,
  type notifications,
  signatureEnvelopes,
  signatureSigners,
  users,
} from "@keycade/db";
import { and, eq, isNull } from "drizzle-orm";
import { type ApplicationAccess, participantResourceAllowed } from "./authorization.js";
import { signatureInputCurrent, signatureSignerEligible } from "./signatures.js";

type Tx = Pick<DatabaseTransaction, "select">;
export type NotificationRow = typeof notifications.$inferSelect;
export const requestedAccessKinds = new Set([
  "access_requested",
  "application_started",
  "application_resume",
  "invitation",
]);

/** Re-evaluated immediately before SMTP, not just when notification intent was written. */
export async function notificationSuppression(
  tx: Tx,
  notification: NotificationRow,
  now: Date,
): Promise<string | null> {
  if (notification.state === "suppressed") return notification.suppressionReason ?? "suppressed";
  if (requestedAccessKinds.has(notification.kind)) return null;
  if (!notification.applicationId || !notification.recipientUserId) return "recipient_unavailable";
  const [user] = await tx.select().from(users).where(eq(users.id, notification.recipientUserId));
  if (!user?.emailVerifiedAt) return "recipient_unverified";
  if (notification.contactId) {
    const [contact] = await tx
      .select()
      .from(applicantContacts)
      .where(
        and(
          eq(applicantContacts.id, notification.contactId),
          eq(applicantContacts.bankId, notification.bankId),
        ),
      );
    if (!contact || contact.userId !== user.id || contact.email !== user.email)
      return "recipient_changed";
  }
  const [app] = await tx
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.bankId, notification.bankId),
        eq(applications.id, notification.applicationId),
      ),
    );
  const [participant] = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, notification.bankId),
        eq(applicationParticipants.applicationId, notification.applicationId),
        eq(applicationParticipants.userId, user.id),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  if (!app || !participant) return "access_removed";
  if (notification.kind === "reminder") {
    if (!["draft", "collecting_information", "needs_information"].includes(app.status))
      return "application_advanced";
    if (participant.role !== "applicant_admin" || participant.scope !== "full")
      return "access_removed";
    const [preference] = await tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.bankId, app.bankId),
          eq(notificationPreferences.userId, user.id),
        ),
      );
    if (preference?.remindersEnabled === false) return "reminders_disabled";
    const [activity] = await tx
      .select()
      .from(applicantActivity)
      .where(eq(applicantActivity.applicationId, app.id));
    if (!activity || activity.episodeId !== notification.episodeId) return "activity_resumed";
    if (notification.availableAt > now) return "not_due";
  } else if (notification.kind === "status_changed") {
    if (
      participant.role !== "applicant_admin" ||
      participant.scope !== "full" ||
      app.revision !== notification.resourceRevision
    )
      return "status_changed_again";
  } else {
    if (["funded", "declined", "withdrawn"].includes(app.status)) return "application_closed";
    if (participant.role === "applicant_admin") {
      const [setup] = await tx
        .select()
        .from(applicationSetups)
        .where(eq(applicationSetups.applicationId, app.id));
      if (!setup?.completedAt) return "setup_required";
    }
    if (notification.kind === "signature_requested") {
      const [signature] = await tx
        .select()
        .from(signatureEnvelopes)
        .where(
          and(
            eq(
              signatureEnvelopes.id,
              notification.resourceId ?? "00000000-0000-0000-0000-000000000000",
            ),
            eq(signatureEnvelopes.applicationId, app.id),
            eq(signatureEnvelopes.bankId, app.bankId),
          ),
        );
      if (
        !signature ||
        signature.stale ||
        !["sent", "partially_signed"].includes(signature.state) ||
        signature.expiresAt <= now
      )
        return "signature_unavailable";
      const [signer] = await tx
        .select()
        .from(signatureSigners)
        .where(
          and(eq(signatureSigners.envelopeId, signature.id), eq(signatureSigners.userId, user.id)),
        );
      if (
        !signer ||
        signer.state !== "pending" ||
        !(await signatureSignerEligible(tx, signature, signer))
      )
        return "signer_changed";
      if (!(await signatureInputCurrent(tx, signature))) return "evidence_changed";
      return null;
    }
    const taskId = notification.resourceId;
    if (!taskId) return "task_unavailable";
    const [task] = await tx
      .select()
      .from(applicationTasks)
      .where(
        and(
          eq(applicationTasks.id, taskId),
          eq(applicationTasks.applicationId, app.id),
          eq(applicationTasks.bankId, app.bankId),
        ),
      );
    if (!task || task.state === "cancelled") return "task_unavailable";
    const assigned =
      task.assigneeParticipantId === participant.id &&
      (task.assigneeGenerationAt?.getTime() ?? null) ===
        (participant.unassignedAt?.getTime() ?? null);
    const access: ApplicationAccess = {
      kind: "participant",
      role: participant.role,
      scope: participant.scope,
      taskIds: [...participant.taskIds, ...(assigned ? [task.id] : [])],
      documentIds: participant.documentIds,
    };
    if (
      !participantResourceAllowed({
        actorUserId: user.id,
        access,
        resource: {
          id: task.id,
          kind: "task",
          visibility: task.visibility,
          subjectUserId: task.subjectUserId,
        },
      })
    )
      return "access_removed";
    if (
      !assigned ||
      task.revision !== notification.resourceRevision ||
      ["completed", "waived"].includes(task.state) ||
      (notification.kind === "task_returned" && task.state !== "needs_changes")
    )
      return "task_changed";
  }
  return null;
}
