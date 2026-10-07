import {
  addStaffNoteSchema,
  assignStaffSchema,
  staffApplicationPageSchema,
  staffOptionsSchema,
  staffPageQuerySchema,
  staffQueueItemSchema,
  staffWorkspaceSchema,
  updateStaffNoteSchema,
} from "@keycade/contracts";
import {
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  bankMemberships,
  type Database,
  type DatabaseTransaction,
  loanProducts,
  staffNotes,
  users,
} from "@keycade/db";
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { type Actor, requireApplicationAccess, requireBankStaff } from "./authorization.js";
import { DomainError, deny } from "./errors.js";

type Tx = DatabaseTransaction;
const assignee = alias(users, "staff_assignee");
const author = alias(users, "note_author");
const editor = alias(users, "note_editor");
const person = <T extends { id: AnyPgColumn; displayName: AnyPgColumn; email: AnyPgColumn }>(
  table: T,
) => ({ id: table.id, displayName: table.displayName, email: table.email });
function parse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError("INVALID_INPUT", 400, "Invalid request.");
  return result.data;
}
const syntheticFilter = (actor: Actor) =>
  actor.kind === "user" && actor.demoBankId ? eq(applications.synthetic, true) : undefined;
function queueQuery(tx: Tx) {
  return tx
    .select({
      row: applications,
      setup: applicationSetups,
      contactEmail: applicantContacts.email,
      productName: loanProducts.name,
      assignedStaffName: assignee.displayName,
    })
    .from(applications)
    .innerJoin(
      applicationSetups,
      and(
        eq(applicationSetups.applicationId, applications.id),
        eq(applicationSetups.bankId, applications.bankId),
      ),
    )
    .leftJoin(
      applicantContacts,
      and(
        eq(applicantContacts.id, applications.contactId),
        eq(applicantContacts.bankId, applications.bankId),
      ),
    )
    .leftJoin(
      loanProducts,
      and(
        eq(loanProducts.id, applications.productId),
        eq(loanProducts.bankId, applications.bankId),
      ),
    )
    .leftJoin(assignee, eq(assignee.id, applications.assignedStaffId));
}
type QueueRow = Awaited<ReturnType<typeof queueQuery>>[number];
function queueItem(result: QueueRow) {
  return staffQueueItemSchema.parse({
    ...result.row,
    productName: result.productName,
    contactEmail: result.contactEmail,
    assignedStaffName: result.assignedStaffName,
    setupStatus: result.setup.completedAt ? "completed" : "in_progress",
    currentStep: result.setup.currentStep === "product" ? "amount" : result.setup.currentStep,
    createdAt: result.row.createdAt.toISOString(),
    updatedAt: result.row.updatedAt.toISOString(),
  });
}

/** All predicates, including the count, are scoped before pagination. UUID breaks every sort tie. */
export async function listStaffApplications(
  db: Database,
  actor: Actor,
  bankId: string,
  input: unknown = {},
) {
  const query = parse(staffPageQuerySchema, input);
  return db.transaction(
    async (tx) => {
      await requireBankStaff(tx, actor, bankId);
      const pattern = query.search ? `%${query.search.replace(/[\\%_]/g, "\\$&")}%` : undefined;
      const where = and(
        eq(applications.bankId, bankId),
        syntheticFilter(actor),
        query.status ? eq(applications.status, query.status) : undefined,
        query.productId ? eq(applications.productId, query.productId) : undefined,
        query.assigneeId === "unassigned"
          ? isNull(applications.assignedStaffId)
          : query.assigneeId
            ? eq(applications.assignedStaffId, query.assigneeId)
            : undefined,
        pattern
          ? or(
              ilike(applications.businessName, pattern),
              ilike(applicantContacts.email, pattern),
              ilike(sql`${applications.id}::text`, pattern),
            )
          : undefined,
      );
      const [{ total } = { total: 0 }] = await tx
        .select({ total: count() })
        .from(applications)
        .innerJoin(
          applicationSetups,
          and(
            eq(applicationSetups.applicationId, applications.id),
            eq(applicationSetups.bankId, applications.bankId),
          ),
        )
        .leftJoin(
          applicantContacts,
          and(
            eq(applicantContacts.id, applications.contactId),
            eq(applicantContacts.bankId, applications.bankId),
          ),
        )
        .where(where);
      const sorts: Record<typeof query.sort, SQL> = {
        updated_desc: desc(applications.updatedAt),
        created_desc: desc(applications.createdAt),
        created_asc: asc(applications.createdAt),
        business_asc: sql`lower(${applications.businessName}) ASC NULLS LAST`,
      };
      const rows = await queueQuery(tx)
        .where(where)
        .orderBy(sorts[query.sort], asc(applications.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);
      return staffApplicationPageSchema.parse({
        items: rows.map(queueItem),
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      });
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function readStaffOptions(db: Database, actor: Actor, bankId: string) {
  return db.transaction(async (tx) => {
    await requireBankStaff(tx, actor, bankId);
    const demo = actor.kind === "user" && actor.demoBankId;
    const products = await tx
      .select({
        id: loanProducts.id,
        name: loanProducts.name,
        version: loanProducts.version,
        active: loanProducts.active,
      })
      .from(loanProducts)
      .where(
        and(eq(loanProducts.bankId, bankId), demo ? eq(loanProducts.synthetic, true) : undefined),
      )
      .orderBy(asc(loanProducts.name), desc(loanProducts.version), asc(loanProducts.id));
    const officers = await tx
      .select({ ...person(users), role: bankMemberships.role })
      .from(bankMemberships)
      .innerJoin(users, eq(users.id, bankMemberships.userId))
      .where(
        and(
          eq(bankMemberships.bankId, bankId),
          isNull(bankMemberships.revokedAt),
          demo ? eq(users.synthetic, true) : undefined,
          demo ? eq(bankMemberships.synthetic, true) : undefined,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id));
    return staffOptionsSchema.parse({ products, officers });
  });
}

async function workspace(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
  // Caller holds staff membership authorization throughout its transaction.
  const [result] = await queueQuery(tx).where(
    and(
      eq(applications.bankId, bankId),
      eq(applications.id, applicationId),
      syntheticFilter(actor),
    ),
  );
  if (!result) return deny();
  const { row, setup } = result;
  const [createdBy] = row.createdByUserId
    ? await tx.select(person(users)).from(users).where(eq(users.id, row.createdByUserId))
    : [];
  const [contact] = row.contactId
    ? await tx
        .select({
          email: applicantContacts.email,
          userId: applicantContacts.userId,
          verifiedAt: users.emailVerifiedAt,
        })
        .from(applicantContacts)
        .leftJoin(users, eq(users.id, applicantContacts.userId))
        .where(and(eq(applicantContacts.bankId, bankId), eq(applicantContacts.id, row.contactId)))
    : [];
  const participants = await tx
    .select({
      ...person(users),
      role: applicationParticipants.role,
      scope: applicationParticipants.scope,
      revokedAt: applicationParticipants.revokedAt,
      verifiedAt: users.emailVerifiedAt,
    })
    .from(applicationParticipants)
    .innerJoin(users, eq(users.id, applicationParticipants.userId))
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
      ),
    )
    .orderBy(asc(applicationParticipants.createdAt), asc(applicationParticipants.id));
  const notes = await tx
    .select({ note: staffNotes, author: person(author), updatedBy: person(editor) })
    .from(staffNotes)
    .innerJoin(author, eq(author.id, staffNotes.authorUserId))
    .innerJoin(editor, eq(editor.id, staffNotes.updatedByUserId))
    .where(and(eq(staffNotes.bankId, bankId), eq(staffNotes.applicationId, applicationId)))
    .orderBy(desc(staffNotes.createdAt), asc(staffNotes.id));
  return staffWorkspaceSchema.parse({
    ...queueItem(result),
    purpose: row.purpose,
    industryCode: row.industryCode,
    industryTaxonomyVersion: row.industryTaxonomyVersion,
    createdBy: createdBy ?? null,
    contact: contact
      ? {
          email: contact.email,
          userId: contact.userId,
          status: !contact.userId ? "pending" : contact.verifiedAt ? "verified" : "unverified",
        }
      : null,
    setup: {
      status: setup.completedAt ? "completed" : "in_progress",
      currentStep: setup.currentStep === "product" ? "amount" : setup.currentStep,
      definitionVersion: setup.definitionVersion,
      revision: setup.revision,
      completedSteps: setup.completedSteps,
      skippedSteps: setup.skippedSteps,
      completedAt: setup.completedAt?.toISOString() ?? null,
    },
    participants: participants.map(({ revokedAt, verifiedAt, ...participant }) => ({
      ...participant,
      status: revokedAt ? "revoked" : "active",
      emailVerified: Boolean(verifiedAt),
    })),
    notes: notes.map(({ note, author: noteAuthor, updatedBy }) => ({
      id: note.id,
      body: note.body,
      author: noteAuthor,
      updatedBy,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    })),
    tasks: null,
    documents: null,
    checks: null,
  });
}
export async function readStaffWorkspace(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireBankStaff(tx, actor, bankId);
      await requireApplicationAccess(tx, actor, bankId, applicationId);
      return workspace(tx, actor, bankId, applicationId);
    },
    { isolationLevel: "repeatable read" },
  );
}

async function lockedApplication(
  tx: Tx,
  actor: Actor,
  bankId: string,
  applicationId: string,
  expectedRevision: number,
) {
  await requireBankStaff(tx, actor, bankId);
  await requireApplicationAccess(tx, actor, bankId, applicationId);
  const [row] = await tx
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.bankId, bankId),
        eq(applications.id, applicationId),
        syntheticFilter(actor),
      ),
    )
    .for("update");
  if (!row || actor.kind !== "user") return deny();
  if (row.revision !== expectedRevision)
    throw new DomainError(
      "REVISION_CONFLICT",
      409,
      "The application changed. Reload and try again.",
    );
  return { row, userId: actor.userId };
}
async function commitChange(
  tx: Tx,
  input: {
    bankId: string;
    applicationId: string;
    userId: string;
    action: string;
    targetId: string;
    changedFields: string[];
    requestId: string;
    now: Date;
  },
) {
  await tx
    .update(applications)
    .set({ revision: sql`${applications.revision} + 1`, updatedAt: input.now })
    .where(and(eq(applications.bankId, input.bankId), eq(applications.id, input.applicationId)));
  await tx
    .update(applicationSetups)
    .set({ revision: sql`${applicationSetups.revision} + 1` })
    .where(
      and(
        eq(applicationSetups.bankId, input.bankId),
        eq(applicationSetups.applicationId, input.applicationId),
      ),
    );
  await tx.insert(auditEvents).values({
    bankId: input.bankId,
    applicationId: input.applicationId,
    actorType: "user",
    actorUserId: input.userId,
    action: input.action,
    targetType: input.action.startsWith("staff_note.") ? "staff_note" : "application",
    targetId: input.targetId,
    changedFields: input.changedFields,
    requestId: input.requestId,
    metadata: {},
    createdAt: input.now,
  });
}

export async function assignApplicationStaff(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
  input: unknown,
  requestId: string,
  options: { clock?: () => Date } = {},
) {
  const parsed = parse(assignStaffSchema, input);
  return db.transaction(async (tx) => {
    const { userId } = await lockedApplication(
      tx,
      actor,
      bankId,
      applicationId,
      parsed.expectedRevision,
    );
    if (parsed.assignedStaffId) {
      const [membership] = await tx
        .select({ userId: bankMemberships.userId })
        .from(bankMemberships)
        .innerJoin(users, eq(users.id, bankMemberships.userId))
        .where(
          and(
            eq(bankMemberships.bankId, bankId),
            eq(bankMemberships.userId, parsed.assignedStaffId),
            isNull(bankMemberships.revokedAt),
            actor.kind === "user" && actor.demoBankId
              ? and(eq(users.synthetic, true), eq(bankMemberships.synthetic, true))
              : undefined,
          ),
        )
        .for("share");
      if (!membership) return deny();
    }
    const now = options.clock?.() ?? new Date();
    await tx
      .update(applications)
      .set({ assignedStaffId: parsed.assignedStaffId })
      .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)));
    await commitChange(tx, {
      bankId,
      applicationId,
      userId,
      action: "application.staff_assigned",
      targetId: applicationId,
      changedFields: ["assignedStaffId"],
      requestId,
      now,
    });
    return workspace(tx, actor, bankId, applicationId);
  });
}
export async function addStaffNote(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
  input: unknown,
  requestId: string,
  options: { clock?: () => Date } = {},
) {
  const parsed = parse(addStaffNoteSchema, input);
  return db.transaction(async (tx) => {
    const { userId } = await lockedApplication(
      tx,
      actor,
      bankId,
      applicationId,
      parsed.expectedRevision,
    );
    const now = options.clock?.() ?? new Date();
    const [note] = await tx
      .insert(staffNotes)
      .values({
        bankId,
        applicationId,
        body: parsed.body,
        authorUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!note) throw new Error("Note creation failed.");
    await commitChange(tx, {
      bankId,
      applicationId,
      userId,
      action: "staff_note.created",
      targetId: note.id,
      changedFields: ["body"],
      requestId,
      now,
    });
    return workspace(tx, actor, bankId, applicationId);
  });
}
export async function updateStaffNote(
  db: Database,
  actor: Actor,
  bankId: string,
  applicationId: string,
  noteId: string,
  input: unknown,
  requestId: string,
  options: { clock?: () => Date } = {},
) {
  const parsed = parse(updateStaffNoteSchema, input);
  return db.transaction(async (tx) => {
    const { userId } = await lockedApplication(
      tx,
      actor,
      bankId,
      applicationId,
      parsed.expectedRevision,
    );
    const now = options.clock?.() ?? new Date();
    const [note] = await tx
      .update(staffNotes)
      .set({ body: parsed.body, updatedByUserId: userId, updatedAt: now })
      .where(
        and(
          eq(staffNotes.bankId, bankId),
          eq(staffNotes.applicationId, applicationId),
          eq(staffNotes.id, noteId),
        ),
      )
      .returning();
    if (!note) return deny();
    await commitChange(tx, {
      bankId,
      applicationId,
      userId,
      action: "staff_note.updated",
      targetId: note.id,
      changedFields: ["body"],
      requestId,
      now,
    });
    return workspace(tx, actor, bankId, applicationId);
  });
}
