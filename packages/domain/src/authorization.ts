import { applicationParticipants, applications, bankMemberships, type Database } from "@keycade/db";
import { and, eq, isNull } from "drizzle-orm";
import { deny } from "./errors.js";

export type Actor =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string }
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
    }
  | { kind: "system" };

export async function requireBankStaff(db: QueryDatabase, actor: Actor, bankId: string) {
  if (actor.kind !== "user") return deny();
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
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
    .limit(1);
  if (!application) return deny();
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
  return { kind: "participant", role: participant.role, scope: participant.scope };
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
  const access = await requireApplicationAccess(db, actor, resource.bankId, resource.applicationId);
  if (!(await policy.allows({ ...resource, actor, access }))) deny();
}
export const requireTaskAccess = requireResourceAccess;
export const requireDocumentAccess = requireResourceAccess;
