import {
  acceptInvitationResponseSchema,
  addBusinessRelationshipSchema,
  createInvitationSchema,
  invitationViewSchema,
  linkRelationshipSchema,
  participantCommandSchema,
  participantsWorkspaceSchema,
  setRelationshipActiveSchema,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applications,
  auditEvents,
  bankMemberships,
  banks,
  businessRelationships,
  type Database,
  type DatabaseTransaction,
  invitations,
  participantCommands,
  users,
} from "@keycade/db";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  canDelegateParticipantGrant,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { validateDocumentGrants } from "./documents.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import { reconcileTasks, unassignParticipantTasks, validateTaskGrants } from "./tasks.js";

type Tx = DatabaseTransaction;
type Invitation = typeof invitations.$inferSelect;
const terminal = new Set(["funded", "declined", "withdrawn"]);
const manageable = (access: ApplicationAccess) =>
  access.kind === "staff" ||
  (access.kind === "participant" && access.role === "applicant_admin" && access.scope === "full");
function parse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  return result.data;
}
function invalidState(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
function state(invitation: Invitation, now: Date) {
  return invitation.status === "pending" && invitation.expiresAt <= now
    ? ("expired" as const)
    : invitation.status;
}

export function createParticipantsService(
  db: Database,
  options: {
    clock?: () => Date;
    borrowerOrigin: string;
    deliveryEnabled: boolean;
    invitationTtlMs?: number;
  },
) {
  const clock = options.clock ?? (() => new Date());
  const ttl = options.invitationTtlMs ?? 7 * 24 * 60 * 60_000;
  const origin = new URL(options.borrowerOrigin);
  if (
    origin.origin !== options.borrowerOrigin ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid borrower origin.");

  async function lockApplication(tx: Tx, bankId: string, applicationId: string) {
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
      .for("update");
    if (!application) return deny();
    return application;
  }
  async function manager(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    // One application lock orders invitation, acceptance, and removal changes together.
    const application = await lockApplication(tx, bankId, applicationId);
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user" || !manageable(access)) return deny();
    if (terminal.has(application.status)) invalidState("This application is closed.");
    return { application, access, userId: actor.userId };
  }
  async function authority(
    tx: Tx,
    access: ApplicationAccess,
    userId: string,
    bankId: string,
    applicationId: string,
  ) {
    if (access.kind === "staff") {
      const [grant] = await tx
        .select()
        .from(bankMemberships)
        .where(
          and(
            eq(bankMemberships.bankId, bankId),
            eq(bankMemberships.userId, userId),
            isNull(bankMemberships.revokedAt),
          ),
        )
        .for("share");
      if (!grant) return deny();
      return {
        inviterKind: "staff" as const,
        inviterGrantId: grant.id,
        inviterGrantUpdatedAt: grant.updatedAt,
      };
    }
    const [grant] = await tx
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.bankId, bankId),
          eq(applicationParticipants.applicationId, applicationId),
          eq(applicationParticipants.userId, userId),
          isNull(applicationParticipants.revokedAt),
        ),
      )
      .for("share");
    if (!grant) return deny();
    return {
      inviterKind: "participant" as const,
      inviterGrantId: grant.id,
      inviterGrantUpdatedAt: grant.updatedAt,
    };
  }
  async function validInviter(tx: Tx, invitation: Invitation) {
    const access = await requireApplicantPortalAccess(
      tx,
      { kind: "user", userId: invitation.inviterUserId },
      invitation.bankId,
      invitation.applicationId,
    );
    if (!canDelegateParticipantGrant(access, invitation)) return deny();
    const grant = await authority(
      tx,
      access,
      invitation.inviterUserId,
      invitation.bankId,
      invitation.applicationId,
    );
    if (
      grant.inviterKind !== invitation.inviterKind ||
      grant.inviterGrantId !== invitation.inviterGrantId ||
      grant.inviterGrantUpdatedAt.getTime() !== invitation.inviterGrantUpdatedAt.getTime()
    )
      return deny();
    await validateTaskGrants(
      tx,
      { kind: "user", userId: invitation.inviterUserId },
      access,
      invitation.bankId,
      invitation.applicationId,
      invitation.taskIds,
      invitation.email,
    );
    await validateDocumentGrants(
      tx,
      { kind: "user", userId: invitation.inviterUserId },
      access,
      invitation.bankId,
      invitation.applicationId,
      invitation.documentIds,
      invitation.email,
    );
  }
  async function audit(
    tx: Tx,
    actorUserId: string,
    bankId: string,
    applicationId: string,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    now: Date,
  ) {
    await tx.insert(auditEvents).values({
      actorType: "user",
      actorUserId,
      bankId,
      applicationId,
      action,
      targetType,
      targetId,
      requestId,
      metadata: {},
      createdAt: now,
    });
  }
  async function existingCommand(
    tx: Tx,
    actorUserId: string,
    bankId: string,
    applicationId: string,
    operation: string,
    input: { idempotencyKey: string },
    payload: unknown,
  ) {
    const keyHash = hashIdentityCredential(input.idempotencyKey);
    const payloadHash = hashIdentityCredential(JSON.stringify(payload));
    const [existing] = await tx
      .select()
      .from(participantCommands)
      .where(
        and(
          eq(participantCommands.bankId, bankId),
          eq(participantCommands.applicationId, applicationId),
          eq(participantCommands.actorUserId, actorUserId),
          eq(participantCommands.operation, operation),
          eq(participantCommands.keyHash, keyHash),
        ),
      );
    if (existing && existing.payloadHash !== payloadHash)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "This request key was already used with different details.",
      );
    return {
      existing,
      values: { actorUserId, bankId, applicationId, operation, keyHash, payloadHash },
    };
  }
  async function queueDelivery(tx: Tx, invitation: Invitation, requestId: string, now: Date) {
    if (!options.deliveryEnabled) return;
    const [contact] = await tx
      .insert(applicantContacts)
      .values({
        bankId: invitation.bankId,
        email: invitation.email,
        synthetic: invitation.synthetic,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [applicantContacts.bankId, applicantContacts.email],
        set: { updatedAt: now },
      })
      .returning();
    if (!contact) throw new Error("Invitation contact creation failed.");
    await tx.insert(accessDeliveryRequests).values({
      bankId: invitation.bankId,
      applicationId: invitation.applicationId,
      invitationId: invitation.id,
      contactId: contact.id,
      portal: "borrower",
      origin: options.borrowerOrigin,
      returnPath: `/invitations/${invitation.id}`,
      expiresAt: invitation.expiresAt,
      requestId,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  async function revokeDeliveries(tx: Tx, invitationId: string, now: Date) {
    await tx
      .update(accessDeliveryRequests)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(accessDeliveryRequests.invitationId, invitationId),
          isNull(accessDeliveryRequests.revokedAt),
        ),
      );
  }
  async function view(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user") return deny();
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)));
    if (!application) return deny();
    const canManage = manageable(access);
    const participants = await tx
      .select({ row: applicationParticipants, displayName: users.displayName, email: users.email })
      .from(applicationParticipants)
      .innerJoin(users, eq(users.id, applicationParticipants.userId))
      .where(
        and(
          eq(applicationParticipants.bankId, bankId),
          eq(applicationParticipants.applicationId, applicationId),
          canManage ? undefined : eq(applicationParticipants.userId, actor.userId),
        ),
      )
      .orderBy(asc(applicationParticipants.createdAt), asc(applicationParticipants.id));
    const relationships =
      access.kind === "participant" && access.role === "adviser"
        ? []
        : await tx
            .select()
            .from(businessRelationships)
            .where(
              and(
                eq(businessRelationships.bankId, bankId),
                eq(businessRelationships.applicationId, applicationId),
                canManage ? undefined : eq(businessRelationships.userId, actor.userId),
                canManage ? undefined : isNull(businessRelationships.removedAt),
              ),
            )
            .orderBy(asc(businessRelationships.createdAt), asc(businessRelationships.id));
    const pending = canManage
      ? await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.bankId, bankId), eq(invitations.applicationId, applicationId)))
          .orderBy(asc(invitations.createdAt), asc(invitations.id))
      : [];
    const deliveryRows = canManage
      ? await tx
          .select({
            invitationId: accessDeliveryRequests.invitationId,
            status: accessDeliveryRequests.status,
          })
          .from(accessDeliveryRequests)
          .where(
            and(
              eq(accessDeliveryRequests.bankId, bankId),
              eq(accessDeliveryRequests.applicationId, applicationId),
              isNull(accessDeliveryRequests.revokedAt),
            ),
          )
          .orderBy(asc(accessDeliveryRequests.createdAt), asc(accessDeliveryRequests.id))
      : [];
    const deliveryStatuses = new Map(deliveryRows.map((row) => [row.invitationId, row.status]));
    return participantsWorkspaceSchema.parse({
      applicationId,
      businessId: application.businessId,
      canManage: canManage && !terminal.has(application.status),
      participants: participants.map(({ row, ...person }) => ({
        id: row.id,
        userId: row.userId,
        ...person,
        role: row.role,
        scope: row.scope,
        taskIds: row.taskIds,
        documentIds: row.documentIds,
        status: row.revokedAt ? "revoked" : "active",
        isSelf: row.userId === actor.userId,
      })),
      relationships: relationships.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        kind: row.kind,
        ownershipPercent: row.ownershipPercent,
        userId: row.userId,
        active: !row.removedAt,
      })),
      invitations: pending.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        scope: row.scope,
        taskIds: row.taskIds,
        documentIds: row.documentIds,
        status: state(row, clock()),
        expiresAt: row.expiresAt.toISOString(),
        deliveryStatus: deliveryStatuses.get(row.id) ?? "disabled",
      })),
    });
  }
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction((tx) => view(tx, actor, bankId, applicationId));
  }
  async function relationshipUser(tx: Tx, bankId: string, applicationId: string, userId: string) {
    const [participant] = await tx
      .select({ id: applicationParticipants.id })
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.bankId, bankId),
          eq(applicationParticipants.applicationId, applicationId),
          eq(applicationParticipants.userId, userId),
          isNull(applicationParticipants.revokedAt),
        ),
      )
      .for("share");
    if (!participant) return deny();
  }
  async function setRelationshipActive(
    actor: Actor,
    bankId: string,
    applicationId: string,
    relationshipId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(setRelationshipActiveSchema, input);
    return db.transaction(async (tx) => {
      const { userId } = await manager(tx, actor, bankId, applicationId);
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        "relationship.status",
        parsed,
        { relationshipId, active: parsed.active },
      );
      if (!command.existing) {
        const [relationship] = await tx
          .select()
          .from(businessRelationships)
          .where(
            and(
              eq(businessRelationships.id, relationshipId),
              eq(businessRelationships.bankId, bankId),
              eq(businessRelationships.applicationId, applicationId),
            ),
          )
          .for("update");
        if (!relationship) return deny();
        const now = clock();
        if (parsed.active !== !relationship.removedAt) {
          await tx
            .update(businessRelationships)
            .set({ removedAt: parsed.active ? null : now, updatedAt: now })
            .where(eq(businessRelationships.id, relationshipId));
          await reconcileTasks(tx, bankId, applicationId, requestId, now);
          await audit(
            tx,
            userId,
            bankId,
            applicationId,
            parsed.active ? "business_relationship.restored" : "business_relationship.removed",
            "business_relationship",
            relationshipId,
            requestId,
            now,
          );
        }
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: relationshipId, createdAt: now });
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function linkRelationship(
    actor: Actor,
    bankId: string,
    applicationId: string,
    relationshipId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(linkRelationshipSchema, input);
    return db.transaction(async (tx) => {
      const { userId } = await manager(tx, actor, bankId, applicationId);
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        "relationship.link",
        parsed,
        { relationshipId, userId: parsed.userId },
      );
      if (!command.existing) {
        const [relationship] = await tx
          .select()
          .from(businessRelationships)
          .where(
            and(
              eq(businessRelationships.id, relationshipId),
              eq(businessRelationships.bankId, bankId),
              eq(businessRelationships.applicationId, applicationId),
              isNull(businessRelationships.removedAt),
            ),
          )
          .for("update");
        if (!relationship) return deny();
        if (relationship.userId && relationship.userId !== parsed.userId)
          invalidState(
            "This person is already linked. Record a separate relationship for a different person.",
          );
        await relationshipUser(tx, bankId, applicationId, parsed.userId);
        const now = clock();
        if (!relationship.userId) {
          await tx
            .update(businessRelationships)
            .set({ userId: parsed.userId, updatedAt: now })
            .where(eq(businessRelationships.id, relationshipId));
          await reconcileTasks(tx, bankId, applicationId, requestId, now);
          await audit(
            tx,
            userId,
            bankId,
            applicationId,
            "business_relationship.linked",
            "business_relationship",
            relationshipId,
            requestId,
            now,
          );
        }
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: relationshipId, createdAt: now });
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function addRelationship(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(addBusinessRelationshipSchema, input);
    return db.transaction(async (tx) => {
      const { application, userId } = await manager(tx, actor, bankId, applicationId);
      if (!application.businessId)
        invalidState("Add the business before recording its owners or contacts.");
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        "relationship.create",
        parsed,
        {
          displayName: parsed.displayName,
          kind: parsed.kind,
          ownershipPercent: parsed.ownershipPercent ?? null,
          userId: parsed.userId ?? null,
        },
      );
      if (!command.existing) {
        if (parsed.userId) await relationshipUser(tx, bankId, applicationId, parsed.userId);
        const now = clock();
        const [relationship] = await tx
          .insert(businessRelationships)
          .values({
            bankId,
            applicationId,
            businessId: application.businessId,
            displayName: parsed.displayName,
            kind: parsed.kind,
            ownershipPercent: parsed.ownershipPercent ?? null,
            userId: parsed.userId ?? null,
            createdByUserId: userId,
            synthetic: application.synthetic,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!relationship) throw new Error("Relationship creation failed.");
        await audit(
          tx,
          userId,
          bankId,
          applicationId,
          "business_relationship.created",
          "business_relationship",
          relationship.id,
          requestId,
          now,
        );
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: relationship.id, createdAt: now });
        await reconcileTasks(tx, bankId, applicationId, requestId, now);
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function createInvitation(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(createInvitationSchema, input);
    parsed.taskIds = [...new Set(parsed.taskIds)].sort();
    parsed.documentIds = [...new Set(parsed.documentIds)].sort();
    return db.transaction(async (tx) => {
      const { application, userId, access } = await manager(tx, actor, bankId, applicationId);
      if (!canDelegateParticipantGrant(access, parsed)) return deny();
      await validateTaskGrants(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        parsed.taskIds,
        parsed.email,
      );
      await validateDocumentGrants(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        parsed.documentIds,
        parsed.email,
      );
      const { idempotencyKey: _key, ...payload } = parsed;
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        "invitation.create",
        parsed,
        payload,
      );
      if (!command.existing) {
        if (!options.deliveryEnabled)
          throw new DomainError(
            "AUTH_DELIVERY_UNAVAILABLE",
            503,
            "Invitation email delivery is unavailable. Please try again later.",
          );
        const now = clock();
        const [invitation] = await tx
          .insert(invitations)
          .values({
            bankId,
            applicationId,
            ...payload,
            inviterUserId: userId,
            ...(await authority(tx, access, userId, bankId, applicationId)),
            expiresAt: new Date(now.getTime() + ttl),
            synthetic: application.synthetic,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!invitation) throw new Error("Invitation creation failed.");
        await queueDelivery(tx, invitation, requestId, now);
        await audit(
          tx,
          userId,
          bankId,
          applicationId,
          "invitation.created",
          "invitation",
          invitation.id,
          requestId,
          now,
        );
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: invitation.id, createdAt: now });
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function changeInvitation(
    actor: Actor,
    bankId: string,
    applicationId: string,
    invitationId: string,
    input: unknown,
    requestId: string,
    operation: "resend" | "revoke",
  ) {
    const parsed = parse(participantCommandSchema, input);
    return db.transaction(async (tx) => {
      const { userId, access } = await manager(tx, actor, bankId, applicationId);
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        `invitation.${operation}`,
        parsed,
        { invitationId },
      );
      if (!command.existing) {
        const [invitation] = await tx
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.id, invitationId),
              eq(invitations.bankId, bankId),
              eq(invitations.applicationId, applicationId),
            ),
          )
          .for("update");
        if (!invitation) return deny();
        if (!canDelegateParticipantGrant(access, invitation)) return deny();
        if (invitation.status === "accepted")
          invalidState("This invitation has already been accepted.");
        const now = clock();
        if (operation === "resend") {
          await validateTaskGrants(
            tx,
            actor,
            access,
            bankId,
            applicationId,
            invitation.taskIds,
            invitation.email,
          );
          await validateDocumentGrants(
            tx,
            actor,
            access,
            bankId,
            applicationId,
            invitation.documentIds,
            invitation.email,
          );
          if (invitation.status === "revoked")
            invalidState("Create a new invitation to invite this person again.");
          if (!options.deliveryEnabled)
            throw new DomainError(
              "AUTH_DELIVERY_UNAVAILABLE",
              503,
              "Invitation email delivery is unavailable. Please try again later.",
            );
          await revokeDeliveries(tx, invitation.id, now);
          const [updated] = await tx
            .update(invitations)
            .set({
              inviterUserId: userId,
              ...(await authority(tx, access, userId, bankId, applicationId)),
              expiresAt: new Date(now.getTime() + ttl),
              updatedAt: now,
            })
            .where(eq(invitations.id, invitationId))
            .returning();
          if (!updated) throw new Error("Invitation resend failed.");
          await queueDelivery(tx, updated, requestId, now);
          await audit(
            tx,
            userId,
            bankId,
            applicationId,
            "invitation.resent",
            "invitation",
            invitationId,
            requestId,
            now,
          );
        } else if (invitation.status !== "revoked") {
          await tx
            .update(invitations)
            .set({ status: "revoked", revokedAt: now, updatedAt: now })
            .where(eq(invitations.id, invitationId));
          await revokeDeliveries(tx, invitationId, now);
          await audit(
            tx,
            userId,
            bankId,
            applicationId,
            "invitation.revoked",
            "invitation",
            invitationId,
            requestId,
            now,
          );
        }
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: invitationId, createdAt: now });
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function removeParticipant(
    actor: Actor,
    bankId: string,
    applicationId: string,
    participantId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(participantCommandSchema, input);
    return db.transaction(async (tx) => {
      const { userId } = await manager(tx, actor, bankId, applicationId);
      const command = await existingCommand(
        tx,
        userId,
        bankId,
        applicationId,
        "participant.remove",
        parsed,
        { participantId },
      );
      if (!command.existing) {
        const [participant] = await tx
          .select()
          .from(applicationParticipants)
          .where(
            and(
              eq(applicationParticipants.id, participantId),
              eq(applicationParticipants.bankId, bankId),
              eq(applicationParticipants.applicationId, applicationId),
            ),
          )
          .for("update");
        if (!participant) return deny();
        if (participant.userId === userId)
          invalidState(
            "Another application administrator or bank staff member must remove your access.",
          );
        const now = clock();
        if (!participant.revokedAt) {
          // This marker identifies the current assignment generation. Keep removals
          // distinct even when an injected clock has not advanced between revocations.
          const unassignedAt = new Date(
            Math.max(now.getTime(), (participant.unassignedAt?.getTime() ?? -1) + 1),
          );
          await unassignParticipantTasks(
            tx,
            bankId,
            applicationId,
            participantId,
            userId,
            requestId,
            now,
          );
          await tx
            .update(applicationParticipants)
            .set({
              revokedAt: now,
              unassignedAt,
              taskIds: [],
              documentIds: [],
              updatedAt: now,
            })
            .where(eq(applicationParticipants.id, participantId));
          const [recipient] = await tx.select().from(users).where(eq(users.id, participant.userId));
          if (recipient) {
            const pending = await tx
              .update(invitations)
              .set({ status: "revoked", revokedAt: now, updatedAt: now })
              .where(
                and(
                  eq(invitations.bankId, bankId),
                  eq(invitations.applicationId, applicationId),
                  or(
                    eq(invitations.email, recipient.email),
                    and(
                      eq(invitations.inviterKind, "participant"),
                      eq(invitations.inviterGrantId, participantId),
                    ),
                  ),
                  eq(invitations.status, "pending"),
                ),
              )
              .returning();
            for (const invitation of pending) {
              await revokeDeliveries(tx, invitation.id, now);
              await audit(
                tx,
                userId,
                bankId,
                applicationId,
                "invitation.revoked",
                "invitation",
                invitation.id,
                requestId,
                now,
              );
            }
          }
          await audit(
            tx,
            userId,
            bankId,
            applicationId,
            "participant.removed",
            "application_participant",
            participantId,
            requestId,
            now,
          );
          await reconcileTasks(tx, bankId, applicationId, requestId, now);
        }
        await tx
          .insert(participantCommands)
          .values({ ...command.values, resultId: participantId, createdAt: now });
      }
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function recipient(tx: Tx, actor: Actor, bankId: string, invitationId: string) {
    if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
    const [user] = await tx.select().from(users).where(eq(users.id, actor.userId));
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.bankId, bankId), eq(invitations.id, invitationId)));
    if (!user || !invitation || user.email !== invitation.email) return deny();
    if (actor.demoBankId && (!user.synthetic || !invitation.synthetic)) return deny();
    return { user, invitation };
  }
  async function readInvitation(actor: Actor, bankId: string, invitationId: string) {
    return db.transaction(async (tx) => {
      const { user, invitation } = await recipient(tx, actor, bankId, invitationId);
      const invitationState = state(invitation, clock());
      if (invitationState === "accepted") {
        const [participant] = await tx
          .select({ id: applicationParticipants.id })
          .from(applicationParticipants)
          .where(
            and(
              eq(applicationParticipants.bankId, bankId),
              eq(applicationParticipants.applicationId, invitation.applicationId),
              eq(applicationParticipants.userId, user.id),
              isNull(applicationParticipants.revokedAt),
            ),
          )
          .for("share");
        if (invitation.acceptedByUserId !== user.id || !participant) return deny();
      }
      const [application] = await tx
        .select()
        .from(applications)
        .where(and(eq(applications.bankId, bankId), eq(applications.id, invitation.applicationId)));
      const [bank] = await tx.select().from(banks).where(eq(banks.id, bankId));
      if (!application || !bank) return deny();
      let inviterValid = true;
      try {
        await validInviter(tx, invitation);
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          !["NOT_FOUND", "SETUP_REQUIRED", "INVALID_STATE"].includes(error.code)
        )
          throw error;
        inviterValid = false;
      }
      return invitationViewSchema.parse({
        id: invitation.id,
        applicationId: invitation.applicationId,
        // Inactive invitations retain only the recipient's invitation metadata. An old link
        // must never remain a window onto subsequent application changes after access ends.
        businessName:
          invitationState === "accepted" || (invitationState === "pending" && inviterValid)
            ? application.businessName
            : null,
        bankName: bank.name,
        role: invitation.role,
        scope: invitation.scope,
        status: invitationState,
        expiresAt: invitation.expiresAt.toISOString(),
        canAccept:
          actor.kind === "user" &&
          !actor.demoBankId &&
          !!user.emailVerifiedAt &&
          invitationState === "pending" &&
          !terminal.has(application.status) &&
          inviterValid,
      });
    });
  }
  async function acceptInvitation(
    actor: Actor,
    bankId: string,
    invitationId: string,
    requestId: string,
  ) {
    if (actor.kind !== "user" || actor.demoBankId) return deny();
    return db.transaction(async (tx) => {
      const initial = await recipient(tx, actor, bankId, invitationId);
      const application = await lockApplication(tx, bankId, initial.invitation.applicationId);
      const { user, invitation } = await recipient(tx, actor, bankId, invitationId);
      if (!user.emailVerifiedAt || terminal.has(application.status)) return deny();
      const [existing] = await tx
        .select()
        .from(applicationParticipants)
        .where(
          and(
            eq(applicationParticipants.bankId, bankId),
            eq(applicationParticipants.applicationId, application.id),
            eq(applicationParticipants.userId, actor.userId),
          ),
        )
        .for("update");
      if (invitation.status === "accepted") {
        if (invitation.acceptedByUserId !== user.id || !existing || existing.revokedAt)
          return deny();
        return acceptInvitationResponseSchema.parse({ applicationId: application.id });
      }
      if (state(invitation, clock()) !== "pending") return deny();
      await validInviter(tx, invitation);
      if (
        existing &&
        !existing.revokedAt &&
        (existing.role !== invitation.role ||
          existing.scope !== invitation.scope ||
          JSON.stringify([...existing.taskIds].sort()) !== JSON.stringify(invitation.taskIds) ||
          JSON.stringify([...existing.documentIds].sort()) !==
            JSON.stringify(invitation.documentIds))
      )
        invalidState(
          "You already have a different application role. Ask an administrator to review your access.",
        );
      if (existing?.revokedAt && invitation.createdAt <= existing.revokedAt) return deny();
      const now = clock();
      if (!existing || existing.revokedAt) {
        await tx
          .insert(applicationParticipants)
          .values({
            bankId,
            applicationId: application.id,
            userId: user.id,
            role: invitation.role,
            scope: invitation.scope,
            taskIds: invitation.taskIds,
            documentIds: invitation.documentIds,
            synthetic: invitation.synthetic,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [applicationParticipants.applicationId, applicationParticipants.userId],
            set: {
              role: invitation.role,
              scope: invitation.scope,
              taskIds: invitation.taskIds,
              documentIds: invitation.documentIds,
              revokedAt: null,
              // Preserve the removal marker: accepting a new grant never restores old assignments.
              unassignedAt: existing?.unassignedAt ?? null,
              updatedAt: now,
            },
          });
      }
      await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: now, acceptedByUserId: user.id, updatedAt: now })
        .where(eq(invitations.id, invitationId));
      await revokeDeliveries(tx, invitationId, now);
      await reconcileTasks(tx, bankId, application.id, requestId, now);
      await audit(
        tx,
        user.id,
        bankId,
        application.id,
        "invitation.accepted",
        "invitation",
        invitationId,
        requestId,
        now,
      );
      return acceptInvitationResponseSchema.parse({ applicationId: application.id });
    });
  }
  return {
    read,
    addRelationship,
    setRelationshipActive,
    linkRelationship,
    createInvitation,
    removeParticipant,
    readInvitation,
    acceptInvitation,
    resendInvitation: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      invitationId: string,
      input: unknown,
      requestId: string,
    ) => changeInvitation(actor, bankId, applicationId, invitationId, input, requestId, "resend"),
    revokeInvitation: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      invitationId: string,
      input: unknown,
      requestId: string,
    ) => changeInvitation(actor, bankId, applicationId, invitationId, input, requestId, "revoke"),
  };
}
export type ParticipantsService = ReturnType<typeof createParticipantsService>;
