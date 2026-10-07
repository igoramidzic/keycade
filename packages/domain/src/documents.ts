import {
  beginDocumentUploadSchema,
  documentMimeTypes,
  documentsViewSchema,
} from "@keycade/contracts";
import {
  applications,
  applicationTasks,
  auditEvents,
  type Database,
  type DatabaseTransaction,
  documents,
  documentVersions,
  taskDocumentEvidence,
  users,
} from "@keycade/db";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  participantResourceAllowed,
  type QueryDatabase,
  type ResourceScopePolicy,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import { taskIsVisible } from "./tasks.js";

type Tx = DatabaseTransaction;
type Document = typeof documents.$inferSelect;
type Version = typeof documentVersions.$inferSelect;
type Task = typeof applicationTasks.$inferSelect;
const closed = new Set(["funded", "declined", "withdrawn"]);
const editable = (status: string, stage?: string) =>
  ["draft", "collecting_information", "needs_information"].includes(status) ||
  (status === "closing" && stage === "closing");
const invalid = (message: string): never => {
  throw new DomainError("INVALID_STATE", 409, message);
};
function isAssignee(access: ApplicationAccess, task: Task) {
  return (
    access.kind === "participant" &&
    access.participantId === task.assigneeParticipantId &&
    (access.unassignedAt?.getTime() ?? null) === (task.assigneeGenerationAt?.getTime() ?? null)
  );
}
function mayUploadTask(actor: Actor, access: ApplicationAccess, task: Task, status: string) {
  return (
    task.state !== "cancelled" &&
    taskIsVisible(actor, access, task) &&
    editable(status, task.stage) &&
    (access.kind === "staff" || isAssignee(access, task))
  );
}
async function taskFor(db: QueryDatabase, bankId: string, applicationId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(applicationTasks)
    .where(
      and(
        eq(applicationTasks.bankId, bankId),
        eq(applicationTasks.applicationId, applicationId),
        eq(applicationTasks.id, taskId),
      ),
    );
  return task;
}
export async function documentIsVisible(
  db: QueryDatabase,
  actor: Actor,
  access: ApplicationAccess,
  document: Document,
): Promise<boolean> {
  if (actor.kind !== "user") return false;
  let effective = access;
  if (document.taskId && access.kind === "participant") {
    const task = await taskFor(db, document.bankId, document.applicationId, document.taskId);
    if (task && taskIsVisible(actor, access, task))
      effective = { ...access, documentIds: [...(access.documentIds ?? []), document.id] };
  }
  return participantResourceAllowed({
    actorUserId: actor.userId,
    access: effective,
    resource: {
      id: document.id,
      kind: "document",
      visibility: document.visibility,
      subjectUserId: document.subjectUserId,
    },
  });
}
export function documentResourceScopePolicy(db: QueryDatabase): ResourceScopePolicy {
  return {
    allows: async ({ actor, access, bankId, applicationId, resourceId }) => {
      const [document] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.bankId, bankId),
            eq(documents.applicationId, applicationId),
            eq(documents.id, resourceId),
          ),
        );
      return !!document && documentIsVisible(db, actor, access, document);
    },
  };
}
export async function validateDocumentGrants(
  tx: Tx,
  actor: Actor,
  access: ApplicationAccess,
  bankId: string,
  applicationId: string,
  documentIds: readonly string[],
  recipientEmail?: string,
) {
  if (!documentIds.length) return;
  const rows = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.bankId, bankId),
        eq(documents.applicationId, applicationId),
        inArray(documents.id, [...documentIds]),
      ),
    );
  if (rows.length !== new Set(documentIds).size) return deny();
  let recipientUserId: string | null = null;
  if (recipientEmail) {
    const [recipient] = await tx.select().from(users).where(eq(users.email, recipientEmail));
    recipientUserId = recipient?.id ?? null;
  }
  for (const document of rows) {
    if (!(await documentIsVisible(tx, actor, access, document))) return deny();
    if (
      document.visibility === "private" &&
      (!recipientUserId || recipientUserId !== document.subjectUserId)
    )
      return deny();
  }
}

export function createDocumentsService(
  db: Database,
  options: {
    clock?: () => Date;
    scanDelayMs?: number;
    maxFileBytes?: number;
    maxBatchFiles?: number;
    uploadTtlMs?: number;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  const limits = {
    maxFileBytes: options.maxFileBytes ?? 25 * 1024 * 1024,
    maxBatchFiles: options.maxBatchFiles ?? 10,
    allowedMimeTypes: [...documentMimeTypes],
  };
  const ttl = options.uploadTtlMs ?? 60 * 60_000;
  const delay = options.scanDelayMs ?? 1_500;
  async function context(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    mutation = false,
  ) {
    const [app] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
      .for("update");
    if (!app) return deny();
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user" || access.kind === "system") return deny();
    if (mutation && closed.has(app.status)) invalid("This application is closed.");
    return { app, access, userId: actor.userId };
  }
  async function loadDocument(
    tx: Tx,
    actor: Actor,
    access: ApplicationAccess,
    bankId: string,
    applicationId: string,
    documentId: string,
  ) {
    const [document] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.bankId, bankId),
          eq(documents.applicationId, applicationId),
          eq(documents.id, documentId),
        ),
      );
    if (!document || !(await documentIsVisible(tx, actor, access, document))) return deny();
    return document;
  }
  async function canWrite(
    tx: Tx,
    actor: Actor,
    access: ApplicationAccess,
    document: Document,
    status: string,
  ) {
    if (closed.has(status)) return false;
    if (document.taskId) {
      const task = await taskFor(tx, document.bankId, document.applicationId, document.taskId);
      return !!task && mayUploadTask(actor, access, task, status);
    }
    return (
      editable(status) &&
      (access.kind === "staff" ||
        (access.kind === "participant" &&
          access.scope === "full" &&
          document.visibility === "shared"))
    );
  }
  async function loadVersion(
    tx: Tx,
    actor: Actor,
    access: ApplicationAccess,
    bankId: string,
    applicationId: string,
    versionId: string,
  ) {
    const [version] = await tx
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.bankId, bankId),
          eq(documentVersions.applicationId, applicationId),
          eq(documentVersions.id, versionId),
        ),
      );
    if (!version) return deny();
    const document = await loadDocument(
      tx,
      actor,
      access,
      bankId,
      applicationId,
      version.documentId,
    );
    return { version, document };
  }
  async function audit(
    tx: Tx,
    document: Document,
    userId: string | null,
    action: string,
    requestId: string,
    now: Date,
    version: Version,
  ) {
    await tx.insert(auditEvents).values({
      bankId: document.bankId,
      applicationId: document.applicationId,
      actorType: userId ? "user" : "system",
      actorUserId: userId,
      action,
      targetType: "document",
      targetId: document.id,
      requestId,
      changedFields: ["version", "uploadState", "scanState"],
      metadata: { versionId: version.id, version: version.version, simulation: true },
      createdAt: now,
    });
  }
  function descriptor(version: Version) {
    return {
      uploadId: version.id,
      versionId: version.id,
      documentId: version.documentId,
      storageKey: version.storageKey,
      fileName: version.fileName,
      mimeType: version.mimeType,
      expectedSize: version.sizeBytes,
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
      uploadState: version.uploadState,
      alreadyFinalized: version.uploadState === "uploaded",
    };
  }
  async function list(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { app, access } = await context(tx, actor, bankId, applicationId);
      const rows = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.bankId, bankId), eq(documents.applicationId, applicationId)))
        .orderBy(desc(documents.createdAt));
      const tasks = await tx
        .select()
        .from(applicationTasks)
        .where(
          and(
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
          ),
        )
        .orderBy(asc(applicationTasks.createdAt));
      const result = [];
      for (const document of rows) {
        if (!(await documentIsVisible(tx, actor, access, document))) continue;
        const versions = await tx
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, document.id))
          .orderBy(desc(documentVersions.version));
        const writable = await canWrite(tx, actor, access, document, app.status);
        result.push({
          ...document,
          currentVersionId:
            versions.find((version) => version.version === document.currentVersion)?.id ?? null,
          canReplace: writable,
          versions: versions.map((version) => ({
            ...version,
            createdAt: version.createdAt.toISOString(),
            canDownload: version.uploadState === "uploaded" && version.scanState === "clean",
            canRetryScan:
              writable &&
              version.uploadState === "uploaded" &&
              version.scanState === "error" &&
              version.version === document.currentVersion,
          })),
        });
      }
      return documentsViewSchema.parse({
        applicationId,
        simulation: true,
        canUpload:
          editable(app.status) &&
          (access.kind === "staff" || (access.kind === "participant" && access.scope === "full")),
        uploadTasks: tasks
          .filter((task) => mayUploadTask(actor, access, task, app.status))
          .map(({ id, title }) => ({ id, title })),
        limits,
        documents: result,
      });
    });
  }
  async function beginUpload(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = beginDocumentUploadSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError("INVALID_INPUT", 400, "Choose a supported file with a safe filename.");
    const data = parsed.data;
    if (data.expectedSize > limits.maxFileBytes)
      throw new DomainError("INVALID_INPUT", 413, "This file exceeds the upload size limit.");
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const { idempotencyKey, ...payload } = data;
      const keyHash = await hashIdentityCredential(idempotencyKey);
      const payloadHash = await hashIdentityCredential(JSON.stringify(payload));
      const [existing] = await tx
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.bankId, bankId),
            eq(documentVersions.applicationId, applicationId),
            eq(documentVersions.uploadedByUserId, userId),
            eq(documentVersions.keyHash, keyHash),
          ),
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This upload key was used for a different file.",
          );
        const document = await loadDocument(
          tx,
          actor,
          access,
          bankId,
          applicationId,
          existing.documentId,
        );
        if (!(await canWrite(tx, actor, access, document, app.status))) return deny();
        if (
          existing.uploadState !== "uploaded" &&
          (existing.uploadState !== "staged" || existing.expiresAt <= clock())
        )
          invalid("This upload has expired. Start a new upload.");
        return descriptor(existing);
      }
      let document: Document;
      if (data.replacesDocumentId) {
        document = await loadDocument(
          tx,
          actor,
          access,
          bankId,
          applicationId,
          data.replacesDocumentId,
        );
        if (data.taskId && data.taskId !== document.taskId) return deny();
        if (!(await canWrite(tx, actor, access, document, app.status))) return deny();
      } else {
        let task: Task | undefined;
        if (data.taskId) {
          task = await taskFor(tx, bankId, applicationId, data.taskId);
          if (!task || !mayUploadTask(actor, access, task, app.status)) return deny();
          if (task.visibility === "private" && !task.subjectUserId) return deny();
        } else if (
          !editable(app.status) ||
          !(access.kind === "staff" || (access.kind === "participant" && access.scope === "full"))
        )
          return deny();
        const [created] = await tx
          .insert(documents)
          .values({
            bankId,
            applicationId,
            taskId: task?.id ?? null,
            visibility: task?.visibility ?? "shared",
            subjectUserId: task?.subjectUserId ?? null,
            createdByUserId: userId,
            createdAt: clock(),
          })
          .returning();
        if (!created) throw new Error("Document creation failed.");
        document = created;
      }
      const [latest] = await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, document.id))
        .orderBy(desc(documentVersions.version))
        .limit(1);
      const now = clock();
      const id = crypto.randomUUID();
      const [version] = await tx
        .insert(documentVersions)
        .values({
          id,
          bankId,
          applicationId,
          documentId: document.id,
          version: (latest?.version ?? 0) + 1,
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.expectedSize,
          storageKey: id,
          uploadedByUserId: userId,
          keyHash,
          payloadHash,
          expiresAt: new Date(now.getTime() + ttl),
          createdAt: now,
        })
        .returning();
      if (!version) throw new Error("Upload reservation failed.");
      await audit(tx, document, userId, "document.upload_started", requestId, now, version);
      return descriptor(version);
    });
  }
  async function upload(actor: Actor, bankId: string, applicationId: string, uploadId: string) {
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const { version, document } = await loadVersion(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        uploadId,
      );
      if (
        version.uploadedByUserId !== userId ||
        !(await canWrite(tx, actor, access, document, app.status))
      )
        return deny();
      if (
        version.uploadState !== "uploaded" &&
        (version.uploadState !== "staged" || version.expiresAt <= clock())
      )
        invalid("This upload has expired. Start a new upload.");
      return descriptor(version);
    });
  }
  /** The caller verifies bytes exist and match this checksum before committing metadata. */
  async function finalizeUpload(
    actor: Actor,
    bankId: string,
    applicationId: string,
    uploadId: string,
    content: { size: number; sha256: string },
    requestId: string,
  ) {
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const { version, document } = await loadVersion(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        uploadId,
      );
      if (
        version.uploadedByUserId !== userId ||
        !(await canWrite(tx, actor, access, document, app.status))
      )
        return deny();
      if (content.size !== version.sizeBytes || !/^[a-f0-9]{64}$/.test(content.sha256))
        throw new DomainError(
          "INVALID_INPUT",
          400,
          "The uploaded content does not match the reservation.",
        );
      if (version.uploadState === "uploaded") {
        if (content.sha256 !== version.sha256)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This upload already contains different content.",
          );
        return descriptor(version);
      }
      if (version.uploadState !== "staged" || version.expiresAt <= clock())
        invalid("This upload has expired. Start a new upload.");
      if (document.currentVersion >= version.version)
        invalid("A newer document version has already been uploaded.");
      const now = clock();
      const [updated] = await tx
        .update(documentVersions)
        .set({
          uploadState: "uploaded",
          sha256: content.sha256,
          uploadedAt: now,
          scanAvailableAt: new Date(now.getTime() + delay),
        })
        .where(eq(documentVersions.id, version.id))
        .returning();
      if (!updated) throw new Error("Upload finalization failed.");
      await tx
        .update(documents)
        .set({ currentVersion: version.version })
        .where(eq(documents.id, document.id));
      if (document.taskId) {
        const task = await taskFor(tx, bankId, applicationId, document.taskId);
        if (!task) return deny();
        await tx.insert(taskDocumentEvidence).values({
          bankId,
          applicationId,
          taskId: task.id,
          documentId: document.id,
          versionId: version.id,
          evidenceRevision: task.evidenceRevision + 1,
          createdByUserId: userId,
          createdAt: now,
        });
        await tx
          .update(applicationTasks)
          .set({
            evidenceRevision: task.evidenceRevision + 1,
            reviewedEvidenceRevision: null,
            state: "open",
            revision: task.revision + 1,
            updatedAt: now,
          })
          .where(eq(applicationTasks.id, task.id));
        await tx.insert(auditEvents).values({
          bankId,
          applicationId,
          actorType: "user",
          actorUserId: userId,
          action: "task.document_evidence_changed",
          targetType: "task",
          targetId: task.id,
          requestId,
          changedFields: ["evidenceRevision", "state"],
          metadata: { versionId: version.id, evidenceRevision: task.evidenceRevision + 1 },
          createdAt: now,
        });
      }
      await audit(tx, document, userId, "document.upload_finished", requestId, now, updated);
      return descriptor(updated);
    });
  }
  async function abandonUpload(
    actor: Actor,
    bankId: string,
    applicationId: string,
    uploadId: string,
    requestId: string,
  ) {
    return db.transaction(async (tx) => {
      const { access, userId } = await context(tx, actor, bankId, applicationId);
      const { version, document } = await loadVersion(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        uploadId,
      );
      if (version.uploadedByUserId !== userId) return deny();
      if (version.uploadState === "uploaded") invalid("A finished upload cannot be cancelled.");
      await tx
        .update(documentVersions)
        .set({ uploadState: "abandoned" })
        .where(eq(documentVersions.id, version.id));
      await audit(tx, document, userId, "document.upload_abandoned", requestId, clock(), version);
      return { storageKey: version.storageKey };
    });
  }
  async function download(actor: Actor, bankId: string, applicationId: string, versionId: string) {
    return db.transaction(async (tx) => {
      const { access } = await context(tx, actor, bankId, applicationId);
      const { version } = await loadVersion(tx, actor, access, bankId, applicationId, versionId);
      if (version.uploadState !== "uploaded" || version.scanState !== "clean")
        invalid(
          "This file is not available for download. It must finish its simulated scan first.",
        );
      return descriptor(version);
    });
  }
  async function retryScan(
    actor: Actor,
    bankId: string,
    applicationId: string,
    versionId: string,
    requestId: string,
  ) {
    await db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const { version, document } = await loadVersion(
        tx,
        actor,
        access,
        bankId,
        applicationId,
        versionId,
      );
      if (!(await canWrite(tx, actor, access, document, app.status))) return deny();
      if (
        version.uploadState !== "uploaded" ||
        version.scanState !== "error" ||
        document.currentVersion !== version.version
      )
        invalid("This scan cannot be retried.");
      const now = clock();
      await tx
        .update(documentVersions)
        .set({
          scanState: "pending",
          scanErrorCode: null,
          scanAvailableAt: new Date(now.getTime() + delay),
          scanGeneration: version.scanGeneration + 1,
          scanClaimToken: null,
          scanLeaseUntil: null,
          scannedAt: null,
        })
        .where(eq(documentVersions.id, version.id));
      await audit(tx, document, userId, "document.scan_retried", requestId, now, version);
    });
    return list(actor, bankId, applicationId);
  }
  /** Internal storage reconciliation; only server adapters call this after a missing-object check. */
  async function markMissing(versionId: string) {
    await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId));
      if (!candidate) return;
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, candidate.applicationId))
        .for("update");
      const [version] = await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId));
      if (!version || version.uploadState !== "uploaded") return;
      await tx
        .update(documentVersions)
        .set({
          uploadState: "missing",
          scanState: "error",
          scanErrorCode: "MISSING_BYTES",
          scanClaimToken: null,
          scanLeaseUntil: null,
        })
        .where(eq(documentVersions.id, versionId));
      const [document] = await tx
        .select()
        .from(documents)
        .where(eq(documents.id, version.documentId));
      if (!document) return;
      const now = clock();
      if (document.taskId && document.currentVersion === version.version) {
        const task = await taskFor(tx, document.bankId, document.applicationId, document.taskId);
        if (task && !["cancelled", "waived"].includes(task.state))
          await tx
            .update(applicationTasks)
            .set({
              state: "open",
              reviewedEvidenceRevision: null,
              revision: task.revision + 1,
              updatedAt: now,
            })
            .where(eq(applicationTasks.id, task.id));
      }
      await audit(tx, document, null, "document.bytes_missing", crypto.randomUUID(), now, version);
    });
  }
  /** Mark before deleting bytes so a crash can only leave unused private bytes, never usable metadata. */
  async function cleanupAbandoned() {
    const expired = await db
      .select()
      .from(documentVersions)
      .where(
        and(eq(documentVersions.uploadState, "staged"), lt(documentVersions.expiresAt, clock())),
      )
      .limit(100);
    for (const version of expired)
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(applications)
          .where(eq(applications.id, version.applicationId))
          .for("update");
        await tx
          .update(documentVersions)
          .set({ uploadState: "abandoned" })
          .where(
            and(
              eq(documentVersions.id, version.id),
              eq(documentVersions.uploadState, "staged"),
              lt(documentVersions.expiresAt, clock()),
            ),
          );
      });
    return db
      .select({ uploadId: documentVersions.id, storageKey: documentVersions.storageKey })
      .from(documentVersions)
      .where(eq(documentVersions.uploadState, "abandoned"));
  }
  return {
    limits,
    list,
    read: list,
    beginUpload,
    upload,
    finalizeUpload,
    abandonUpload,
    download,
    retryScan,
    markMissing,
    cleanupAbandoned,
  };
}
