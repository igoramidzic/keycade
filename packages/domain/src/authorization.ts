import {
  applicationParticipants,
  applicationSetups,
  applications,
  bankMemberships,
  banks,
  type Database,
  users,
} from "@keycade/db";
import { and, eq, isNull } from "drizzle-orm";
import { DomainError, deny } from "./errors.js";

export type Actor =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; demoBankId?: string }
  | {
      kind: "system";
      bankId: string;
      applicationIds: readonly string[];
      capabilities: readonly "application:read"[];
    };
export type QueryDatabase = Pick<Database, "select">;
export type ApplicationAccess =
  | { kind: "staff"; role: "officer" | "admin" }
  | {
      kind: "participant";
      role: "applicant_admin" | "owner" | "adviser";
      scope: "full" | "assigned";
      participantId?: string;
      unassignedAt?: Date | null;
      taskIds?: readonly string[];
      documentIds?: readonly string[];
    }
  | { kind: "system" };

export async function requireBankStaff(db: QueryDatabase, actor: Actor, bankId: string) {
  if (actor.kind !== "user") return deny();
  if (actor.demoBankId && actor.demoBankId !== bankId) return deny();
  if (actor.demoBankId) {
    const [bank] = await db.select().from(banks).where(eq(banks.id, bankId));
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
    if (!bank?.synthetic || !user?.synthetic) return deny();
  }
  const [membership] = await db
    .select()
    .from(bankMemberships)
    .where(
      and(
        eq(bankMemberships.bankId, bankId),
        eq(bankMemberships.userId, actor.userId),
        isNull(bankMemberships.revokedAt),
      ),
    )
    .limit(1)
    .for("share");
  if (!membership) return deny();
  return { kind: "staff" as const, role: membership.role };
}

export async function requireApplicationAccess(
  db: QueryDatabase,
  actor: Actor,
  bankId: string,
  applicationId: string,
): Promise<ApplicationAccess> {
  if (actor.kind === "anonymous") return deny();
  if (actor.kind === "user" && actor.demoBankId && actor.demoBankId !== bankId) return deny();
  const [application] = await db
    .select({ id: applications.id, synthetic: applications.synthetic })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
    .limit(1);
  if (!application) return deny();
  if (actor.kind === "user" && actor.demoBankId) {
    const [bank] = await db.select().from(banks).where(eq(banks.id, bankId));
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
    if (!application.synthetic || !bank?.synthetic || !user?.synthetic) return deny();
  }
  if (actor.kind === "system") {
    if (
      actor.bankId !== bankId ||
      !actor.applicationIds.includes(applicationId) ||
      !actor.capabilities.includes("application:read")
    )
      return deny();
    return { kind: "system" };
  }
  const [membership] = await db
    .select()
    .from(bankMemberships)
    .where(
      and(
        eq(bankMemberships.bankId, bankId),
        eq(bankMemberships.userId, actor.userId),
        isNull(bankMemberships.revokedAt),
      ),
    )
    .limit(1)
    .for("share");
  if (membership) return { kind: "staff", role: membership.role };
  const [participant] = await db
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
        eq(applicationParticipants.userId, actor.userId),
        isNull(applicationParticipants.revokedAt),
      ),
    )
    .limit(1)
    .for("share");
  if (!participant) return deny();
  return {
    kind: "participant",
    role: participant.role,
    scope: participant.scope,
    participantId: participant.id,
    unassignedAt: participant.unassignedAt,
    taskIds: participant.taskIds,
    documentIds: participant.documentIds,
  };
}

/** Resource adapters must load current visibility and subject from the database, never request data. */
export function participantResourceAllowed(input: {
  actorUserId: string;
  access: ApplicationAccess;
  resource: {
    id: string;
    kind: "task" | "document";
    visibility: "shared" | "assigned" | "private";
    subjectUserId?: string | null;
  };
}): boolean {
  const { access, resource, actorUserId } = input;
  if (access.kind === "staff") return true;
  if (access.kind !== "participant") return false;
  const assigned =
    (resource.kind === "task" ? access.taskIds : access.documentIds)?.includes(resource.id) ??
    false;
  if (resource.visibility === "private")
    return resource.subjectUserId === actorUserId && (access.scope === "full" || assigned);
  if (resource.visibility === "assigned") return assigned;
  return access.scope === "full" || assigned;
}

export function canDelegateParticipantGrant(
  access: ApplicationAccess,
  grant: { role: "applicant_admin" | "owner" | "adviser"; scope: "full" | "assigned" },
): boolean {
  if (grant.role === "applicant_admin" && grant.scope !== "full") return false;
  if (access.kind === "staff") return true;
  return (
    access.kind === "participant" &&
    access.role === "applicant_admin" &&
    access.scope === "full" &&
    (grant.role === "applicant_admin" || grant.scope === "assigned")
  );
}

/** Applicant workflow prerequisite; collaborator resource scopes remain separately enforced. */
export async function requireApplicantPortalAccess(
  db: QueryDatabase,
  actor: Actor,
  bankId: string,
  applicationId: string,
) {
  const access = await requireApplicationAccess(db, actor, bankId, applicationId);
  if (access.kind === "participant" && access.role === "applicant_admin") {
    const [setup] = await db
      .select()
      .from(applicationSetups)
      .where(
        and(
          eq(applicationSetups.bankId, bankId),
          eq(applicationSetups.applicationId, applicationId),
        ),
      );
    if (!setup?.completedAt) {
      const [application] = await db
        .select({ status: applications.status })
        .from(applications)
        .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)));
      if (application && ["withdrawn", "declined", "funded"].includes(application.status))
        throw new DomainError("INVALID_STATE", 409, "This application is closed.");
      throw new DomainError(
        "SETUP_REQUIRED",
        409,
        "Finish initial setup before opening the application portal.",
      );
    }
  }
  return access;
}

// T12/T13 supply implementations using current resource records and assignments.
// Participation alone never grants access to private tasks/documents.
export interface ResourceScopePolicy {
  allows(input: {
    actor: Actor;
    bankId: string;
    applicationId: string;
    resourceId: string;
    access: ApplicationAccess;
  }): Promise<boolean>;
}
const denyResourcePolicy: ResourceScopePolicy = { allows: async () => false };
export async function requireResourceAccess(
  db: QueryDatabase,
  actor: Actor,
  resource: { bankId: string; applicationId: string; resourceId: string },
  policy: ResourceScopePolicy = denyResourcePolicy,
): Promise<void> {
  const access = await requireApplicantPortalAccess(
    db,
    actor,
    resource.bankId,
    resource.applicationId,
  );
  if (!(await policy.allows({ ...resource, actor, access }))) deny();
}
export const requireTaskAccess = requireResourceAccess;
export const requireDocumentAccess = requireResourceAccess;
