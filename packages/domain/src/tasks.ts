import {
  assignTaskSchema,
  createManualTaskSchema,
  reviewTaskSchema,
  saveTaskAnswerSchema,
  taskRevisionSchema,
  tasksViewSchema,
  taskViewSchema,
  waiveTaskSchema,
} from "@keycade/contracts";
import {
  applicationParticipants,
  applicationRequirementPolicies,
  applications,
  applicationTasks,
  auditEvents,
  businessRelationships,
  closingConditions,
  type Database,
  type DatabaseTransaction,
  documents,
  documentVersions,
  loanProducts,
  productRequirementRules,
  taskAnswers,
  taskAssignments,
  taskReviews,
  taskSignaturePolicies,
  users,
} from "@keycade/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  participantResourceAllowed,
  type QueryDatabase,
  type ResourceScopePolicy,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { hydrateSecureTaskInputs, reconcileChecks } from "./checks.js";
import { requireNonClosingSignatureTask } from "./closing-policy.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import { queueTaskNotification, recordApplicantActivity } from "./notification-intents.js";
import { requireNonSignatureTask } from "./signatures.js";
import {
  calculateTaskProgress,
  demoRequirementRules,
  evaluateRequirementRules,
  settledTaskStates,
  taskTransitionAllowed,
} from "./task-rules.js";

async function taskDocumentsReady(db: QueryDatabase, taskId: string) {
  const rows = await db
    .select({ uploadState: documentVersions.uploadState, scanState: documentVersions.scanState })
    .from(documents)
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.documentId, documents.id),
        eq(documentVersions.version, documents.currentVersion),
      ),
    )
    .where(eq(documents.taskId, taskId));
  return rows.every(
    (version) => version.uploadState === "uploaded" && version.scanState === "clean",
  );
}

type Tx = DatabaseTransaction;
type Task = typeof applicationTasks.$inferSelect;
const closed = new Set(["funded", "declined", "withdrawn"]);
const evidenceEditable = (status: string, stage: string) =>
  ["draft", "collecting_information", "needs_information"].includes(status) ||
  (status === "closing" && stage === "closing");
const conflict = () => {
  throw new DomainError("REVISION_CONFLICT", 409, "This task changed. Refresh it and try again.");
};
const invalid = (message: string): never => {
  throw new DomainError("INVALID_STATE", 409, message);
};
function parse<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError("INVALID_INPUT", 400, "Invalid task request.");
  return result.data;
}
async function lockApplication(tx: Tx, bankId: string, applicationId: string) {
  const [app] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
    .for("update");
  if (!app) return deny();
  return app;
}
async function audit(
  tx: Tx,
  task: Task,
  actorUserId: string | null,
  action: string,
  requestId: string,
  now: Date,
  changedFields: string[],
) {
  if (actorUserId && ["task.answer", "task.submit"].includes(action))
    await recordApplicantActivity(tx, task.bankId, task.applicationId, actorUserId, now);
  await queueTaskNotification(tx, task, action, now);
  await tx.insert(auditEvents).values({
    bankId: task.bankId,
    applicationId: task.applicationId,
    actorUserId,
    actorType: actorUserId ? "user" : "system",
    action,
    targetType: "task",
    targetId: task.id,
    changedFields,
    requestId,
    metadata: {
      occurrence: task.occurrence,
      revision: task.revision,
      ruleVersion: task.ruleVersion,
    },
    createdAt: now,
  });
}
/** A retained historical assignee is not a grant in a later participation lifecycle. */
function hasCurrentAssignment(access: ApplicationAccess, task: Task): boolean {
  return (
    access.kind === "participant" &&
    access.participantId === task.assigneeParticipantId &&
    (access.unassignedAt?.getTime() ?? null) === (task.assigneeGenerationAt?.getTime() ?? null)
  );
}
export function taskIsVisible(actor: Actor, access: ApplicationAccess, task: Task): boolean {
  if (actor.kind !== "user") return false;
  const delegated = hasCurrentAssignment(access, task);
  const effective =
    access.kind === "participant" && delegated
      ? { ...access, taskIds: [...(access.taskIds ?? []), task.id] }
      : access;
  return participantResourceAllowed({
    actorUserId: actor.userId,
    access: effective,
    resource: {
      id: task.id,
      kind: "task",
      visibility: task.visibility,
      subjectUserId: task.subjectUserId,
    },
  });
}
export function taskResourceScopePolicy(db: QueryDatabase): ResourceScopePolicy {
  return {
    allows: async ({ actor, access, bankId, applicationId, resourceId }) => {
      const [task] = await db
        .select()
        .from(applicationTasks)
        .where(
          and(
            eq(applicationTasks.id, resourceId),
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
          ),
        );
      return !!task && taskIsVisible(actor, access, task);
    },
  };
}
export async function validateTaskGrants(
  tx: Tx,
  actor: Actor,
  access: ApplicationAccess,
  bankId: string,
  applicationId: string,
  taskIds: readonly string[],
  recipientEmail?: string,
) {
  if (!taskIds.length) return;
  const rows = await tx
    .select()
    .from(applicationTasks)
    .where(
      and(
        eq(applicationTasks.bankId, bankId),
        eq(applicationTasks.applicationId, applicationId),
        inArray(applicationTasks.id, [...taskIds]),
      ),
    );
  if (rows.length !== new Set(taskIds).size) return deny();
  let recipientUserId: string | null = null;
  if (recipientEmail) {
    const [recipient] = await tx.select().from(users).where(eq(users.email, recipientEmail));
    recipientUserId = recipient?.id ?? null;
  }
  for (const task of rows) {
    if (task.state === "cancelled" || !taskIsVisible(actor, access, task)) return deny();
    if (
      task.visibility === "private" &&
      (!recipientUserId || recipientUserId !== task.subjectUserId)
    )
      return deny();
  }
}
export async function readTaskProgress(
  tx: QueryDatabase,
  actor: Actor,
  access: ApplicationAccess,
  bankId: string,
  applicationId: string,
) {
  const rows = await tx
    .select()
    .from(applicationTasks)
    .where(
      and(eq(applicationTasks.bankId, bankId), eq(applicationTasks.applicationId, applicationId)),
    );
  return calculateTaskProgress(rows.filter((task) => taskIsVisible(actor, access, task)));
}

/** Caller shares the application lock with setup, owner and participant mutations. */
export async function reconcileTasks(
  tx: Tx,
  bankId: string,
  applicationId: string,
  requestId: string,
  now: Date,
) {
  const app = await lockApplication(tx, bankId, applicationId);
  if (!app.productId || closed.has(app.status)) {
    await reconcileChecks(tx, bankId, applicationId, requestId, now);
    return;
  }
  let [policy] = await tx
    .select()
    .from(applicationRequirementPolicies)
    .where(eq(applicationRequirementPolicies.applicationId, applicationId));
  if (!policy) {
    const [product] = await tx
      .select()
      .from(loanProducts)
      .where(and(eq(loanProducts.bankId, bankId), eq(loanProducts.id, app.productId)));
    if (!product) return deny();
    await tx
      .insert(productRequirementRules)
      .values({
        bankId,
        productId: product.id,
        version: 1,
        rules: demoRequirementRules(product.slug),
        createdAt: now,
      })
      .onConflictDoNothing();
    const [rules] = await tx
      .select()
      .from(productRequirementRules)
      .where(
        and(
          eq(productRequirementRules.bankId, bankId),
          eq(productRequirementRules.productId, product.id),
        ),
      )
      .orderBy(desc(productRequirementRules.version))
      .limit(1);
    if (!rules) throw new Error("Requirement policy creation failed.");
    [policy] = await tx
      .insert(applicationRequirementPolicies)
      .values({
        applicationId,
        bankId,
        productId: product.id,
        ruleSetId: rules.id,
        version: rules.version,
        rules: rules.rules,
        evidenceReusePolicy: "never",
        createdAt: now,
      })
      .returning();
  }
  if (!policy) throw new Error("Requirement policy pinning failed.");
  const owners = await tx
    .select()
    .from(businessRelationships)
    .where(
      and(
        eq(businessRelationships.bankId, bankId),
        eq(businessRelationships.applicationId, applicationId),
        eq(businessRelationships.kind, "owner"),
        isNull(businessRelationships.removedAt),
      ),
    );
  const required = evaluateRequirementRules(policy.rules, {
    requestedAmount: app.requestedAmount,
    businessName: app.businessName,
    industryCode: app.industryCode,
    owners,
  });
  const existing = await tx
    .select()
    .from(applicationTasks)
    .where(
      and(
        eq(applicationTasks.bankId, bankId),
        eq(applicationTasks.applicationId, applicationId),
        eq(applicationTasks.source, "rule"),
      ),
    )
    .orderBy(desc(applicationTasks.occurrence));
  const latest = new Map<string, Task>();
  for (const task of existing)
    if (!task.stableKey.startsWith("check-input:") && !latest.has(task.stableKey))
      latest.set(task.stableKey, task);
  const desired = new Map(required.map((rule) => [rule.stableKey, rule]));
  for (const task of latest.values()) {
    const rule = desired.get(task.stableKey);
    if (task.state !== "cancelled" && (!rule || rule.inputFingerprint !== task.inputFingerprint)) {
      const [cancelled] = await tx
        .update(applicationTasks)
        .set({
          state: "cancelled",
          revision: task.revision + 1,
          reason: rule
            ? "Relevant application facts changed. A new occurrence requires fresh evidence."
            : "This requirement no longer applies to the current application facts.",
          updatedAt: now,
        })
        .where(eq(applicationTasks.id, task.id))
        .returning();
      if (cancelled) {
        latest.set(task.stableKey, cancelled);
        await audit(tx, cancelled, null, "task.cancelled", requestId, now, ["state", "reason"]);
      }
    }
  }
  const participants = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, bankId),
        eq(applicationParticipants.applicationId, applicationId),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  for (const rule of required) {
    const previous = latest.get(rule.stableKey);
    if (previous && previous.state !== "cancelled") continue;
    const assignee = rule.subjectUserId
      ? participants.find((p) => p.userId === rule.subjectUserId)
      : rule.visibility !== "private"
        ? participants.find((p) => p.role === "applicant_admin" && p.scope === "full")
        : undefined;
    const [task] = await tx
      .insert(applicationTasks)
      .values({
        bankId,
        applicationId,
        stableKey: rule.stableKey,
        occurrence: (previous?.occurrence ?? 0) + 1,
        source: "rule",
        ruleSetId: policy.ruleSetId,
        ruleVersion: policy.version,
        title: rule.title,
        description: rule.description,
        reason: rule.reason,
        stage: rule.stage,
        required: rule.required,
        visibility: rule.visibility,
        subjectUserId: rule.subjectUserId,
        subjectRelationshipId: rule.subjectRelationshipId,
        assigneeParticipantId: assignee?.id ?? null,
        assigneeGenerationAt: assignee?.unassignedAt ?? null,
        inputRevision: app.revision,
        inputFingerprint: rule.inputFingerprint,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!task) throw new Error("Requirement task creation failed.");
    if (assignee)
      await tx.insert(taskAssignments).values({
        bankId,
        applicationId,
        taskId: task.id,
        participantId: assignee.id,
        createdAt: now,
      });
    await audit(tx, task, null, "task.created", requestId, now, ["state", "assignment"]);
  }
  await reconcileChecks(tx, bankId, applicationId, requestId, now);
}
export async function unassignParticipantTasks(
  tx: Tx,
  bankId: string,
  applicationId: string,
  participantId: string,
  actorUserId: string,
  requestId: string,
  now: Date,
) {
  const rows = await tx
    .select()
    .from(applicationTasks)
    .where(
      and(
        eq(applicationTasks.bankId, bankId),
        eq(applicationTasks.applicationId, applicationId),
        eq(applicationTasks.assigneeParticipantId, participantId),
      ),
    );
  for (const task of rows) {
    if (settledTaskStates.has(task.state)) continue;
    const [updated] = await tx
      .update(applicationTasks)
      .set({
        assigneeParticipantId: null,
        assigneeGenerationAt: null,
        revision: task.revision + 1,
        updatedAt: now,
      })
      .where(eq(applicationTasks.id, task.id))
      .returning();
    await tx.insert(taskAssignments).values({
      bankId,
      applicationId,
      taskId: task.id,
      participantId: null,
      actorUserId,
      createdAt: now,
    });
    if (updated)
      await audit(tx, updated, actorUserId, "task.unassigned", requestId, now, [
        "assigneeParticipantId",
      ]);
  }
}
export function createTasksService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function context(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    mutation = false,
  ) {
    const app = await lockApplication(tx, bankId, applicationId);
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user" || access.kind === "system") return deny();
    if (mutation && closed.has(app.status)) invalid("This application is closed.");
    return { app, access, userId: actor.userId };
  }
  function summary(access: ApplicationAccess, task: Task, status: string, documentsReady: boolean) {
    const mutable = !closed.has(status) && task.state !== "cancelled";
    const own = hasCurrentAssignment(access, task);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      stage: task.stage,
      required: task.required,
      state: task.state,
      source: task.source,
      visibility: task.visibility,
      reason: task.reason,
      stableKey: task.stableKey,
      occurrence: task.occurrence,
      revision: task.revision,
      evidenceRevision: task.evidenceRevision,
      assigneeParticipantId: task.assigneeParticipantId,
      subjectUserId: task.subjectUserId,
      dueAt: task.dueAt?.toISOString() ?? null,
      canEdit: mutable && own && evidenceEditable(status, task.stage),
      canSubmit:
        mutable &&
        own &&
        evidenceEditable(status, task.stage) &&
        task.evidenceRevision > 0 &&
        documentsReady &&
        taskTransitionAllowed(task.state, "submit"),
      canReview:
        mutable &&
        access.kind === "staff" &&
        (evidenceEditable(status, task.stage) || ["submitted", "in_review"].includes(status)),
    };
  }
  async function taskDetail(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    taskId: string,
    access: ApplicationAccess,
    status: string,
  ) {
    const [task] = await tx
      .select()
      .from(applicationTasks)
      .where(
        and(
          eq(applicationTasks.bankId, bankId),
          eq(applicationTasks.applicationId, applicationId),
          eq(applicationTasks.id, taskId),
        ),
      );
    if (!task || !taskIsVisible(actor, access, task)) return deny();
    const [detail] = await details(tx, access, [task], status);
    if (!detail) return deny();
    return detail;
  }
  // Only hydrate authorized tasks, with one query per related table rather than per dropdown.
  async function details(tx: Tx, access: ApplicationAccess, visible: Task[], status: string) {
    if (!visible.length) return [];
    const secureInputs = await hydrateSecureTaskInputs(tx, { status }, access, visible);
    const taskIds = visible.map((task) => task.id);
    const signaturePolicies = await tx
      .select()
      .from(taskSignaturePolicies)
      .where(inArray(taskSignaturePolicies.taskId, taskIds));
    const pendingClosingSignatures = await tx
      .select({ taskId: closingConditions.taskId })
      .from(closingConditions)
      .where(
        and(inArray(closingConditions.taskId, taskIds), eq(closingConditions.kind, "signature")),
      );
    const closingSignatureIds = new Set(pendingClosingSignatures.map((c) => c.taskId));
    const signaturesByTask = new Map(
      signaturePolicies.map((policy) => [policy.taskId, policy.envelopeId]),
    );
    const answers = await tx
      .select()
      .from(taskAnswers)
      .where(inArray(taskAnswers.taskId, taskIds))
      .orderBy(desc(taskAnswers.evidenceRevision));
    const reviews = await tx
      .select()
      .from(taskReviews)
      .where(inArray(taskReviews.taskId, taskIds))
      .orderBy(desc(taskReviews.createdAt), desc(taskReviews.taskRevision));
    const assignments = await tx
      .select()
      .from(taskAssignments)
      .where(inArray(taskAssignments.taskId, taskIds))
      .orderBy(desc(taskAssignments.createdAt), desc(taskAssignments.id));
    const versions = await tx
      .select({
        taskId: documents.taskId,
        uploadState: documentVersions.uploadState,
        scanState: documentVersions.scanState,
      })
      .from(documents)
      .innerJoin(
        documentVersions,
        and(
          eq(documentVersions.documentId, documents.id),
          eq(documentVersions.version, documents.currentVersion),
        ),
      )
      .where(inArray(documents.taskId, taskIds));
    function byTask<T extends { taskId: string }>(rows: T[]) {
      const groups = new Map<string, T[]>();
      for (const row of rows) {
        const group = groups.get(row.taskId) ?? [];
        group.push(row);
        groups.set(row.taskId, group);
      }
      return groups;
    }
    const answersByTask = byTask(answers);
    const reviewsByTask = byTask(reviews);
    const assignmentsByTask = byTask(assignments);
    const blockedTasks = new Set(
      versions
        .filter((version) => version.uploadState !== "uploaded" || version.scanState !== "clean")
        .map((version) => version.taskId),
    );
    return visible.map((task) => {
      const history = answersByTask.get(task.id) ?? [];
      const secure = secureInputs.get(task.id);
      const signatureEnvelopeId = signaturesByTask.get(task.id) ?? null;
      return taskViewSchema.parse({
        ...summary(access, task, status, !blockedTasks.has(task.id)),
        inputKind:
          signatureEnvelopeId || closingSignatureIds.has(task.id)
            ? "signature"
            : (secure?.inputKind ?? "answer"),
        signatureEnvelopeId,
        secureInput: secure?.secureInput ?? null,
        ...(secure ? { canEdit: false, canSubmit: false, canReview: false } : {}),
        ...(signatureEnvelopeId || closingSignatureIds.has(task.id)
          ? { canEdit: false, canSubmit: false, canReview: false }
          : {}),
        answer: history[0]?.answer ?? null,
        answers: history.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
        reviews: (reviewsByTask.get(task.id) ?? []).map((x) => ({
          ...x,
          createdAt: x.createdAt.toISOString(),
        })),
        assignments: (assignmentsByTask.get(task.id) ?? []).map((x) => ({
          participantId: x.participantId,
          createdAt: x.createdAt.toISOString(),
        })),
      });
    });
  }

  async function view(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    access: ApplicationAccess,
    status: string,
  ) {
    const all = await tx
      .select()
      .from(applicationTasks)
      .where(
        and(eq(applicationTasks.bankId, bankId), eq(applicationTasks.applicationId, applicationId)),
      )
      .orderBy(asc(applicationTasks.createdAt), asc(applicationTasks.id));
    const visible = all.filter((task) => taskIsVisible(actor, access, task));
    const assignees =
      access.kind === "staff"
        ? await tx
            .select({
              id: applicationParticipants.id,
              userId: users.id,
              displayName: users.displayName,
            })
            .from(applicationParticipants)
            .innerJoin(users, eq(users.id, applicationParticipants.userId))
            .where(
              and(
                eq(applicationParticipants.bankId, bankId),
                eq(applicationParticipants.applicationId, applicationId),
                isNull(applicationParticipants.revokedAt),
              ),
            )
        : [];
    return tasksViewSchema.parse({
      applicationId,
      simulation: true,
      canManage: access.kind === "staff" && !closed.has(status),
      tasks: await details(tx, access, visible, status),
      progress: calculateTaskProgress(visible),
      assignees,
    });
  }
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { app, access } = await context(tx, actor, bankId, applicationId);
      await reconcileTasks(tx, bankId, applicationId, crypto.randomUUID(), clock());
      return view(tx, actor, bankId, applicationId, access, app.status);
    });
  }
  async function detail(actor: Actor, bankId: string, applicationId: string, taskId: string) {
    return db.transaction(async (tx) => {
      const { app, access } = await context(tx, actor, bankId, applicationId);
      return taskDetail(tx, actor, bankId, applicationId, taskId, access, app.status);
    });
  }
  async function validAssignee(
    tx: Tx,
    bankId: string,
    applicationId: string,
    participantId: string | null,
    task?: Task,
  ) {
    if (!participantId) return;
    const [participant] = await tx
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.bankId, bankId),
          eq(applicationParticipants.applicationId, applicationId),
          eq(applicationParticipants.id, participantId),
          isNull(applicationParticipants.revokedAt),
        ),
      );
    if (
      !participant ||
      (task?.visibility === "private" && participant.userId !== task.subjectUserId)
    )
      return deny();
    return participant;
  }
  async function createManual(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const data = parse(createManualTaskSchema, input);
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      if (access.kind !== "staff") return deny();
      const { idempotencyKey, ...payload } = data;
      const stableKey = `manual:${await hashIdentityCredential(`${userId}:${idempotencyKey}`)}`;
      const payloadHash = await hashIdentityCredential(JSON.stringify(payload));
      const [existing] = await tx
        .select()
        .from(applicationTasks)
        .where(
          and(
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
            eq(applicationTasks.stableKey, stableKey),
          ),
        );
      if (existing) {
        if (existing.manualPayloadHash !== payloadHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request key was used for a different task.",
          );
      } else {
        if (!evidenceEditable(app.status, payload.stage))
          invalid(
            "Requirements are locked for review. Request information before adding requirements.",
          );
        const assignee = await validAssignee(
          tx,
          bankId,
          applicationId,
          payload.assigneeParticipantId ?? null,
        );
        const now = clock();
        const [task] = await tx
          .insert(applicationTasks)
          .values({
            bankId,
            applicationId,
            stableKey,
            source: "manual",
            title: payload.title,
            description: payload.description,
            stage: payload.stage,
            required: payload.required,
            visibility: payload.visibility,
            reason: "Added by bank staff.",
            assigneeParticipantId: payload.assigneeParticipantId ?? null,
            assigneeGenerationAt: assignee?.unassignedAt ?? null,
            dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
            inputRevision: app.revision,
            manualPayloadHash: payloadHash,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!task) throw new Error("Manual task creation failed.");
        if (task.assigneeParticipantId)
          await tx.insert(taskAssignments).values({
            bankId,
            applicationId,
            taskId: task.id,
            participantId: task.assigneeParticipantId,
            actorUserId: userId,
            createdAt: now,
          });
        await audit(tx, task, userId, "task.created", requestId, now, ["state", "assignment"]);
      }
      return view(tx, actor, bankId, applicationId, access, app.status);
    });
  }
  async function mutate(
    actor: Actor,
    bankId: string,
    applicationId: string,
    taskId: string,
    input: unknown,
    requestId: string,
    operation: "assign" | "answer" | "submit" | "review" | "waive",
  ) {
    const parsed =
      operation === "assign"
        ? parse(assignTaskSchema, input)
        : operation === "answer"
          ? parse(saveTaskAnswerSchema, input)
          : operation === "review"
            ? parse(reviewTaskSchema, input)
            : operation === "waive"
              ? parse(waiveTaskSchema, input)
              : parse(taskRevisionSchema, input);
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const [task] = await tx
        .select()
        .from(applicationTasks)
        .where(
          and(
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
            eq(applicationTasks.id, taskId),
          ),
        )
        .for("update");
      if (!task || !taskIsVisible(actor, access, task)) return deny();
      if (operation === "assign" || operation === "review" || operation === "waive") {
        if (access.kind !== "staff") return deny();
      } else if (!hasCurrentAssignment(access, task)) return deny();
      if (operation !== "assign") {
        await requireNonSignatureTask(tx, task.id);
        await requireNonClosingSignatureTask(tx, task.id);
        if (task.stableKey.startsWith("check-input:"))
          invalid("Use the private identifier or authorization action for this task.");
      }
      if (
        (operation === "review" || operation === "waive") &&
        !(
          evidenceEditable(app.status, task.stage) ||
          ["submitted", "in_review"].includes(app.status)
        )
      )
        invalid("This requirement is locked at the current application stage.");
      if (task.revision !== parsed.expectedRevision) conflict();
      if (
        (operation === "answer" || operation === "submit") &&
        !evidenceEditable(app.status, task.stage)
      )
        invalid("This application is not accepting task evidence at its current stage.");
      if (operation !== "assign" && !taskTransitionAllowed(task.state, operation))
        invalid("This action is unavailable in the current task state.");
      const now = clock();
      const update: Partial<typeof applicationTasks.$inferInsert> = {
        revision: task.revision + 1,
        updatedAt: now,
      };
      let fields: string[] = [];
      if (operation === "assign") {
        if (settledTaskStates.has(task.state)) invalid("Only unfinished tasks can be assigned.");
        const data = parse(assignTaskSchema, input);
        const assignee = await validAssignee(tx, bankId, applicationId, data.participantId, task);
        update.assigneeParticipantId = data.participantId;
        update.assigneeGenerationAt = assignee?.unassignedAt ?? null;
        if (data.dueAt !== undefined) update.dueAt = data.dueAt ? new Date(data.dueAt) : null;
        await tx.insert(taskAssignments).values({
          bankId,
          applicationId,
          taskId,
          participantId: data.participantId,
          actorUserId: userId,
          createdAt: now,
        });
        fields = ["assigneeParticipantId", "dueAt"];
      } else if (operation === "answer") {
        const data = parse(saveTaskAnswerSchema, input);
        if (
          (task.visibility === "private" || task.stableKey.startsWith("tax-document-readiness:")) &&
          !["confirmed", "needs_help"].includes(data.answer)
        )
          throw new DomainError(
            "INVALID_INPUT",
            400,
            "For this demo readiness task, enter confirmed or needs_help. Do not enter identifiers.",
          );
        update.evidenceRevision = task.evidenceRevision + 1;
        update.reviewedEvidenceRevision = null;
        update.state = "open";
        await tx.insert(taskAnswers).values({
          bankId,
          applicationId,
          taskId,
          evidenceRevision: update.evidenceRevision,
          answer: data.answer,
          authorUserId: userId,
          createdAt: now,
        });
        fields = ["evidenceRevision", "state"];
      } else if (operation === "submit") {
        if (task.evidenceRevision === 0) invalid("Save evidence before submitting this task.");
        if (!(await taskDocumentsReady(tx, task.id)))
          invalid("Linked documents must finish a clean simulated scan before submission.");
        update.state = "submitted";
        fields = ["state"];
      } else {
        const data =
          operation === "review"
            ? parse(reviewTaskSchema, input)
            : { ...parse(waiveTaskSchema, input), decision: "waived" as const };
        if (data.decision === "completed" && !(await taskDocumentsReady(tx, task.id)))
          invalid("Linked documents must finish a clean simulated scan before review.");
        update.state = data.decision;
        update.reviewedEvidenceRevision = task.evidenceRevision;
        await tx.insert(taskReviews).values({
          bankId,
          applicationId,
          taskId,
          evidenceRevision: task.evidenceRevision,
          taskRevision: task.revision + 1,
          decision: data.decision,
          reason: data.reason,
          reviewerUserId: userId,
          createdAt: now,
        });
        fields = ["state", "reviewedEvidenceRevision"];
      }
      const [updated] = await tx
        .update(applicationTasks)
        .set(update)
        .where(
          and(
            eq(applicationTasks.id, taskId),
            eq(applicationTasks.revision, parsed.expectedRevision),
          ),
        )
        .returning();
      if (!updated) conflict();
      if (updated) await audit(tx, updated, userId, `task.${operation}`, requestId, now, fields);
      return taskDetail(tx, actor, bankId, applicationId, taskId, access, app.status);
    });
  }
  return {
    read,
    detail,
    createManual,
    assign: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      input: unknown,
      requestId: string,
    ) => mutate(actor, bankId, applicationId, taskId, input, requestId, "assign"),
    saveAnswer: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      input: unknown,
      requestId: string,
    ) => mutate(actor, bankId, applicationId, taskId, input, requestId, "answer"),
    submit: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      input: unknown,
      requestId: string,
    ) => mutate(actor, bankId, applicationId, taskId, input, requestId, "submit"),
    review: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      input: unknown,
      requestId: string,
    ) => mutate(actor, bankId, applicationId, taskId, input, requestId, "review"),
    waive: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      input: unknown,
      requestId: string,
    ) => mutate(actor, bankId, applicationId, taskId, input, requestId, "waive"),
  };
}
export type TasksService = ReturnType<typeof createTasksService>;
