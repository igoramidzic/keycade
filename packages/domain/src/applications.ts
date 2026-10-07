import {
  publicApplicationSchema,
  staffApplicationSchema,
  updatePurposeSchema,
} from "@keycade/contracts";
import { applicationSetups, applications, auditEvents, type Database } from "@keycade/db";
import { and, eq, sql } from "drizzle-orm";
import {
  type Actor,
  type QueryDatabase,
  requireApplicantPortalAccess,
  requireApplicationAccess,
  requireBankStaff,
} from "./authorization.js";
import { DomainError, deny } from "./errors.js";

async function findApplication(db: QueryDatabase, bankId: string, applicationId: string) {
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
    .limit(1);
  return application ?? deny();
}

export async function readApplication(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
) {
  const access = await requireApplicantPortalAccess(db, actor, bankId, applicationId);
  const row = await findApplication(db, bankId, applicationId);
  const assigned = access.kind === "participant" && access.scope === "assigned";
  return publicApplicationSchema.parse({
    ...row,
    requestedAmount: assigned ? null : row.requestedAmount,
    purpose: assigned ? null : row.purpose,
  });
}

export async function readStaffApplication(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
) {
  await requireBankStaff(db, actor, bankId);
  await requireApplicationAccess(db, actor, bankId, applicationId);
  const row = await findApplication(db, bankId, applicationId);
  return staffApplicationSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

// Small consequential command proving the same boundary used by future draft services.
// No raw old/new purpose values enter the append-only audit trail.
export async function updateApplicationPurpose(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
  input: { expectedRevision: number; purpose: string },
  requestId: string,
) {
  const parsed = updatePurposeSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  return db.transaction(async (tx) => {
    // Match participant removal's application-before-membership lock order.
    const [current] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
      .for("update");
    if (!current) return deny();
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (
      actor.kind !== "user" ||
      (access.kind !== "staff" &&
        !(
          access.kind === "participant" &&
          access.role === "applicant_admin" &&
          access.scope === "full"
        ))
    )
      return deny();
    if (current.revision !== parsed.data.expectedRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        409,
        "The application changed. Reload and try again.",
      );
    if (!["draft", "collecting_information", "needs_information"].includes(current.status))
      throw new DomainError("INVALID_STATE", 409, "The application is locked for review.");
    const [updated] = await tx
      .update(applications)
      .set({
        purpose: parsed.data.purpose,
        revision: sql`${applications.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.bankId, bankId),
          eq(applications.revision, parsed.data.expectedRevision),
        ),
      )
      .returning();
    if (!updated)
      throw new DomainError(
        "REVISION_CONFLICT",
        409,
        "The application changed. Reload and try again.",
      );
    await tx
      .update(applicationSetups)
      .set({
        revision: updated.revision,
        completedSteps: sql`CASE WHEN ${applicationSetups.completedAt} IS NULL THEN array_remove(${applicationSetups.completedSteps}, 'purpose') ELSE ${applicationSetups.completedSteps} END`,
      })
      .where(eq(applicationSetups.applicationId, applicationId));
    await tx.insert(auditEvents).values({
      bankId,
      applicationId,
      actorType: "user",
      actorUserId: actor.userId,
      action: "application.purpose_updated",
      targetType: "application",
      targetId: applicationId,
      changedFields: ["purpose"],
      requestId,
      metadata: {},
    });
    return publicApplicationSchema.parse(updated);
  });
}
