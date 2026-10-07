import { randomUUID } from "node:crypto";
import {
  applicantActivity,
  applicationParticipants,
  type applicationTasks,
  type DatabaseTransaction,
  type NotificationKind,
  notifications,
} from "@keycade/db";
import { and, eq, isNull } from "drizzle-orm";

type Tx = DatabaseTransaction;
/** Call inside the application's writing transaction; reads/polling are not activity. */
export async function recordApplicantActivity(
  tx: Tx,
  bankId: string,
  applicationId: string,
  userId: string,
  now: Date,
) {
  const [participant] = await tx
    .select({ id: applicationParticipants.id })
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
        eq(applicationParticipants.userId, userId),
        eq(applicationParticipants.role, "applicant_admin"),
        eq(applicationParticipants.scope, "full"),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  if (!participant) return;
  await tx
    .insert(applicantActivity)
    .values({ bankId, applicationId, episodeId: randomUUID(), lastMeaningfulAt: now })
    .onConflictDoUpdate({
      target: applicantActivity.applicationId,
      set: { episodeId: randomUUID(), lastMeaningfulAt: now },
    });
}

export async function queueNotification(
  tx: Tx,
  input: {
    bankId: string;
    applicationId: string;
    recipientUserId: string;
    kind: Extract<
      NotificationKind,
      "task_assigned" | "task_returned" | "status_changed" | "reminder" | "signature_requested"
    >;
    sourceKey: string;
    resourceId?: string;
    resourceRevision?: number;
    episodeId?: string;
    reminderOrdinal?: number;
    availableAt?: Date;
    now: Date;
  },
) {
  const { sourceKey, now, ...values } = input;
  await tx
    .insert(notifications)
    .values({
      ...values,
      deduplicationKey: `${input.bankId}:${input.applicationId}:${input.kind}:${sourceKey}:${input.recipientUserId}`,
      availableAt: input.availableAt ?? now,
      createdAt: now,
    })
    .onConflictDoNothing({ target: notifications.deduplicationKey });
}

export async function queueTaskNotification(
  tx: Tx,
  task: typeof applicationTasks.$inferSelect,
  action: string,
  now: Date,
) {
  const kind =
    action === "task.assign" || action === "task.created"
      ? "task_assigned"
      : action === "task.review" && task.state === "needs_changes"
        ? "task_returned"
        : null;
  if (!kind || !task.assigneeParticipantId) return;
  const [participant] = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.id, task.assigneeParticipantId),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  if (
    !participant ||
    (participant.unassignedAt?.getTime() ?? null) !== (task.assigneeGenerationAt?.getTime() ?? null)
  )
    return;
  await queueNotification(tx, {
    bankId: task.bankId,
    applicationId: task.applicationId,
    recipientUserId: participant.userId,
    kind,
    sourceKey: `${task.id}:${task.revision}`,
    resourceId: task.id,
    resourceRevision: task.revision,
    now,
  });
}

export async function queueApplicationStatusNotifications(
  tx: Tx,
  bankId: string,
  applicationId: string,
  revision: number,
  now: Date,
) {
  const people = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
        eq(applicationParticipants.role, "applicant_admin"),
        eq(applicationParticipants.scope, "full"),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  for (const person of people)
    await queueNotification(tx, {
      bankId,
      applicationId,
      recipientUserId: person.userId,
      kind: "status_changed",
      sourceKey: `status:${revision}`,
      resourceRevision: revision,
      now,
    });
}
