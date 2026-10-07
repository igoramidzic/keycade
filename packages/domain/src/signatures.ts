import { createHash, randomUUID } from "node:crypto";
import {
  createSignatureEnvelopeSchema,
  type SignatureEvent,
  signatureActionSchema,
  signatureEventSchema,
  signaturesViewSchema,
} from "@keycade/contracts";
import {
  applicationParticipants,
  applications,
  applicationTasks,
  auditEvents,
  checkInputTasks,
  type Database,
  type DatabaseTransaction,
  documents,
  documentVersions,
  signatureArtifacts,
  signatureEnvelopes,
  signatureNotificationOutbox,
  signatureProviderEvents,
  signatureSendOutbox,
  signatureSigners,
  taskSignaturePolicies,
  users,
} from "@keycade/db";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  type QueryDatabase,
  requireApplicantPortalAccess,
  requireBankStaff,
} from "./authorization.js";
import { materialInputsEditable } from "./checks.js";
import { documentIsVisible } from "./documents.js";
import { DomainError, deny } from "./errors.js";
import { recordApplicantActivity } from "./notification-intents.js";
import { taskIsVisible } from "./tasks.js";

type Tx = DatabaseTransaction;
type Envelope = typeof signatureEnvelopes.$inferSelect;
type Signer = typeof signatureSigners.$inferSelect;
const terminal = new Set(["completed", "declined", "expired", "voided"]);
const closed = new Set(["funded", "declined", "withdrawn"]);
const policyEditable = (status: string, stage: string) =>
  materialInputsEditable(status) || (status === "closing" && stage === "closing");
const invalid = (message: string): never => {
  throw new DomainError("INVALID_STATE", 409, message);
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function rows(db: QueryDatabase, envelope: Envelope) {
  const [source] = await db
    .select({ document: documents, version: documentVersions })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, envelope.sourceVersionId));
  const [task] = await db
    .select()
    .from(applicationTasks)
    .where(eq(applicationTasks.id, envelope.taskId));
  const signers = await db
    .select()
    .from(signatureSigners)
    .where(eq(signatureSigners.envelopeId, envelope.id))
    .orderBy(asc(signatureSigners.id));
  return { source, task, signers };
}
/** Current source, task evidence, application and policy are checked again inside every completion transaction. */
export async function signatureInputCurrent(db: QueryDatabase, envelope: Envelope) {
  const { source, task } = await rows(db, envelope);
  const [policy] = await db
    .select()
    .from(taskSignaturePolicies)
    .where(eq(taskSignaturePolicies.taskId, envelope.taskId));
  const [app] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, envelope.applicationId));
  return !!(
    !envelope.stale &&
    app &&
    !closed.has(app.status) &&
    source &&
    task &&
    task.state !== "cancelled" &&
    policy?.envelopeId === envelope.id &&
    source.document.currentVersion === source.version.version &&
    source.version.uploadState === "uploaded" &&
    source.version.scanState === "clean" &&
    task.evidenceRevision === (envelope.completedEvidenceRevision ?? envelope.taskEvidenceRevision)
  );
}
export async function signatureSignerEligible(
  db: QueryDatabase,
  envelope: Envelope,
  signer: Signer,
) {
  const [participant] = await db
    .select()
    .from(applicationParticipants)
    .where(eq(applicationParticipants.id, signer.participantId));
  const [user] = await db.select().from(users).where(eq(users.id, signer.userId));
  if (
    !participant ||
    participant.revokedAt ||
    participant.userId !== signer.userId ||
    participant.bankId !== envelope.bankId ||
    participant.applicationId !== envelope.applicationId ||
    (participant.unassignedAt?.getTime() ?? null) !==
      (signer.participantGenerationAt?.getTime() ?? null) ||
    !user?.emailVerifiedAt ||
    user.email !== signer.email
  )
    return false;
  try {
    const actor: Actor = { kind: "user", userId: signer.userId };
    const access = await requireApplicantPortalAccess(
      db,
      actor,
      envelope.bankId,
      envelope.applicationId,
    );
    const { source, task } = await rows(db, envelope);
    return !!(
      source &&
      task &&
      taskIsVisible(actor, access, task) &&
      (await documentIsVisible(db, actor, access, source.document))
    );
  } catch (error) {
    if (error instanceof DomainError) return false;
    throw error;
  }
}

/** Readiness requires current completed signature evidence and all current intended signer grants. */
export async function signatureTaskEvidenceCurrent(db: QueryDatabase, taskId: string) {
  const [policy] = await db
    .select()
    .from(taskSignaturePolicies)
    .where(eq(taskSignaturePolicies.taskId, taskId));
  if (!policy) return true;
  const [envelope] = await db
    .select()
    .from(signatureEnvelopes)
    .where(eq(signatureEnvelopes.id, policy.envelopeId));
  if (!envelope || envelope.state !== "completed" || !(await signatureInputCurrent(db, envelope)))
    return false;
  const { signers } = await rows(db, envelope);
  if (!signers.length) return false;
  for (const signer of signers)
    if (signer.state !== "signed" || !(await signatureSignerEligible(db, envelope, signer)))
      return false;
  return true;
}
export type SignatureEvidenceReader = (taskId: string) => Promise<boolean>;
/** Share only during one read evaluation under the application lock. Create a new
 * reader after any writes; neither transactions nor later requests reuse this memo. */
export function createSignatureEvidenceReader(db: QueryDatabase): SignatureEvidenceReader {
  const current = new Map<string, Promise<boolean>>();
  return (taskId) => {
    let result = current.get(taskId);
    if (!result) {
      result = signatureTaskEvidenceCurrent(db, taskId);
      current.set(taskId, result);
    }
    return result;
  };
}
async function audit(
  tx: Tx,
  envelope: Envelope,
  action: string,
  now: Date,
  requestId: string,
  userId?: string,
) {
  await tx.insert(auditEvents).values({
    bankId: envelope.bankId,
    applicationId: envelope.applicationId,
    actorType: userId ? "user" : "system",
    actorUserId: userId ?? null,
    action,
    targetType: "signature_envelope",
    targetId: envelope.id,
    requestId,
    metadata: { simulated: true },
    createdAt: now,
  });
}
/** Generic answers and reviewer actions cannot satisfy an envelope-owned task. */
export async function requireNonSignatureTask(db: QueryDatabase, taskId: string) {
  const [policy] = await db
    .select()
    .from(taskSignaturePolicies)
    .where(eq(taskSignaturePolicies.taskId, taskId));
  if (policy) invalid("Complete the assigned simulated signature request for this task.");
}

/** Called while holding the application lock when source bytes change or disappear. */
export async function invalidateDocumentSignatures(tx: Tx, documentId: string, now: Date) {
  const affected = await tx
    .select({ envelope: signatureEnvelopes })
    .from(signatureEnvelopes)
    .innerJoin(documentVersions, eq(documentVersions.id, signatureEnvelopes.sourceVersionId))
    .innerJoin(taskSignaturePolicies, eq(taskSignaturePolicies.envelopeId, signatureEnvelopes.id))
    .where(eq(documentVersions.documentId, documentId));
  for (const { envelope } of affected) {
    if (await signatureInputCurrent(tx, envelope)) continue;
    await tx
      .update(signatureEnvelopes)
      .set({ stale: true, updatedAt: now })
      .where(eq(signatureEnvelopes.id, envelope.id));
    const [task] = await tx
      .select()
      .from(applicationTasks)
      .where(eq(applicationTasks.id, envelope.taskId));
    if (task?.state === "completed" && task.evidenceRevision === envelope.completedEvidenceRevision)
      await tx
        .update(applicationTasks)
        .set({
          state: "open",
          evidenceRevision: task.evidenceRevision + 1,
          reviewedEvidenceRevision: null,
          revision: task.revision + 1,
          updatedAt: now,
        })
        .where(eq(applicationTasks.id, task.id));
  }
}
async function applyEvent(
  tx: Tx,
  envelope: Envelope,
  event: SignatureEvent,
  now: Date,
  requestId: string,
  userId?: string,
) {
  const payloadHash = hash(event);
  const [previous] = await tx
    .select()
    .from(signatureProviderEvents)
    .where(eq(signatureProviderEvents.eventId, event.eventId));
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "This event ID already identifies another event.",
      );
    return;
  }
  let applied = false;
  const current = await signatureInputCurrent(tx, envelope);
  if (!terminal.has(envelope.state)) {
    if (now >= envelope.expiresAt) {
      await tx
        .update(signatureEnvelopes)
        .set({ state: "expired", sendClaimToken: null, sendLeaseUntil: null, updatedAt: now })
        .where(eq(signatureEnvelopes.id, envelope.id));
      applied = event.type === "expired";
      if (!applied) await audit(tx, envelope, "signature.expired", now, requestId);
    } else if (event.type === "voided") {
      await tx
        .update(signatureEnvelopes)
        .set({ state: "voided", sendClaimToken: null, sendLeaseUntil: null, updatedAt: now })
        .where(eq(signatureEnvelopes.id, envelope.id));
      applied = true;
    } else if (
      current &&
      now < envelope.expiresAt &&
      ["sent", "partially_signed"].includes(envelope.state) &&
      (event.type === "signer_signed" || event.type === "signer_declined") &&
      event.signerId
    ) {
      const { signers } = await rows(tx, envelope);
      const signer = signers.find((s) => s.id === event.signerId);
      if (signer?.state === "pending" && (await signatureSignerEligible(tx, envelope, signer))) {
        const state = event.type === "signer_signed" ? "signed" : "declined";
        await tx
          .update(signatureSigners)
          .set({ state, actedAt: now })
          .where(eq(signatureSigners.id, signer.id));
        if (state === "declined") {
          await tx
            .update(signatureEnvelopes)
            .set({ state: "declined", updatedAt: now })
            .where(eq(signatureEnvelopes.id, envelope.id));
        } else if (signers.every((s) => s.id === signer.id || s.state === "signed")) {
          let allCurrent = true;
          for (const intended of signers)
            if (!(await signatureSignerEligible(tx, envelope, intended))) allCurrent = false;
          if (allCurrent) {
            const evidenceRevision = envelope.taskEvidenceRevision + 1;
            const body = [
              "KEYCADE SIMULATED SIGNATURE ARTIFACT",
              "Synthetic demonstration only. This is not a legally executed contract.",
              `Envelope: ${envelope.id}`,
              `Source document version: ${envelope.sourceVersionId}`,
              `Task: ${envelope.taskId}`,
              ...signers.map((s) => `Synthetic signer ${s.id}: signed`),
              `Completed at: ${now.toISOString()}`,
              "",
            ].join("\n");
            await tx.insert(signatureArtifacts).values({
              envelopeId: envelope.id,
              taskId: envelope.taskId,
              evidenceRevision,
              body,
              sha256: createHash("sha256").update(body).digest("hex"),
              createdAt: now,
            });
            const [task] = await tx
              .select()
              .from(applicationTasks)
              .where(eq(applicationTasks.id, envelope.taskId));
            if (!task) return deny();
            await tx
              .update(applicationTasks)
              .set({
                state: "completed",
                evidenceRevision,
                reviewedEvidenceRevision: evidenceRevision,
                revision: task.revision + 1,
                updatedAt: now,
              })
              .where(eq(applicationTasks.id, task.id));
            await tx
              .update(signatureEnvelopes)
              .set({
                state: "completed",
                completedAt: now,
                completedEvidenceRevision: evidenceRevision,
                updatedAt: now,
              })
              .where(eq(signatureEnvelopes.id, envelope.id));
            await audit(tx, envelope, "signature.system_completed", now, requestId);
          } else
            await tx
              .update(signatureEnvelopes)
              .set({ stale: true, updatedAt: now })
              .where(eq(signatureEnvelopes.id, envelope.id));
        } else
          await tx
            .update(signatureEnvelopes)
            .set({ state: "partially_signed", updatedAt: now })
            .where(eq(signatureEnvelopes.id, envelope.id));
        applied = true;
      }
    } else if (!current)
      await tx
        .update(signatureEnvelopes)
        .set({ stale: true, updatedAt: now })
        .where(eq(signatureEnvelopes.id, envelope.id));
  }
  await tx.insert(signatureProviderEvents).values({
    eventId: event.eventId,
    envelopeId: envelope.id,
    payloadHash,
    type: event.type,
    signerId: event.signerId ?? null,
    outcome: applied ? "applied" : "ignored",
    occurredAt: new Date(event.occurredAt),
    receivedAt: now,
  });
  if (applied) await audit(tx, envelope, `signature.${event.type}`, now, requestId, userId);
}
/** Only call after authenticating the provider payload. Public transports must verify its HMAC first. */
export async function applyVerifiedSignatureEvent(
  db: Database,
  input: unknown,
  options: { now?: Date; requestId?: string } = {},
) {
  const parsed = signatureEventSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid signature event.");
  const event = parsed.data;
  return db.transaction(async (tx) => {
    const [envelope] = await tx
      .select()
      .from(signatureEnvelopes)
      .where(eq(signatureEnvelopes.id, event.envelopeId));
    if (!envelope) return deny();
    await tx
      .select()
      .from(applications)
      .where(eq(applications.id, envelope.applicationId))
      .for("update");
    const [locked] = await tx
      .select()
      .from(signatureEnvelopes)
      .where(eq(signatureEnvelopes.id, envelope.id))
      .for("update");
    if (!locked) return deny();
    await applyEvent(
      tx,
      locked,
      event,
      options.now ?? new Date(),
      options.requestId ?? randomUUID(),
    );
    return { ok: true as const };
  });
}
export function createSignaturesService(db: Database, options: { clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => new Date());
  async function context(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    staff = false,
  ) {
    const [app] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
      .for("update");
    if (!app || actor.kind !== "user") return deny();
    const access = staff
      ? await requireBankStaff(tx, actor, bankId)
      : await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (access.kind === "system") return deny();
    return { app, access, userId: actor.userId };
  }
  async function visible(tx: Tx, actor: Actor, access: ApplicationAccess, envelope: Envelope) {
    if (access.kind === "staff") return true;
    const { signers } = await rows(tx, envelope);
    const own = signers.find((s) => actor.kind === "user" && s.userId === actor.userId);
    return !!own && (await signatureSignerEligible(tx, envelope, own));
  }
  async function load(
    tx: Tx,
    actor: Actor,
    access: ApplicationAccess,
    bankId: string,
    applicationId: string,
    envelopeId: string,
  ) {
    const [envelope] = await tx
      .select()
      .from(signatureEnvelopes)
      .where(
        and(
          eq(signatureEnvelopes.id, envelopeId),
          eq(signatureEnvelopes.bankId, bankId),
          eq(signatureEnvelopes.applicationId, applicationId),
        ),
      )
      .for("update");
    if (!envelope || !(await visible(tx, actor, access, envelope))) return deny();
    return envelope;
  }
  async function view(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    const { app, access } = await context(tx, actor, bankId, applicationId);
    const all = await tx
      .select()
      .from(signatureEnvelopes)
      .where(
        and(
          eq(signatureEnvelopes.bankId, bankId),
          eq(signatureEnvelopes.applicationId, applicationId),
        ),
      )
      .orderBy(desc(signatureEnvelopes.createdAt), desc(signatureEnvelopes.id));
    const envelopes = [];
    for (const envelope of all) {
      if (!(await visible(tx, actor, access, envelope))) continue;
      const { source, task, signers } = await rows(tx, envelope);
      if (!source || !task) continue;
      const current = await signatureInputCurrent(tx, envelope);
      const expired = !terminal.has(envelope.state) && clock() >= envelope.expiresAt;
      const own = signers.find((s) => actor.kind === "user" && s.userId === actor.userId);
      const canSign = !!(
        current &&
        !expired &&
        own?.state === "pending" &&
        ["sent", "partially_signed"].includes(envelope.state) &&
        (await signatureSignerEligible(tx, envelope, own))
      );
      envelopes.push({
        ...envelope,
        state: expired ? "expired" : envelope.state,
        simulated: true,
        taskTitle: task.title,
        sourceFileName: source.version.fileName,
        stale: !current,
        createdAt: envelope.createdAt.toISOString(),
        expiresAt: envelope.expiresAt.toISOString(),
        completedAt: envelope.completedAt?.toISOString() ?? null,
        signers: signers.map((s) => ({ ...s, actedAt: s.actedAt?.toISOString() ?? null })),
        canSign,
        canDecline: canSign,
        canSend:
          access.kind === "staff" &&
          current &&
          !expired &&
          envelope.state === "draft" &&
          ["not_sent", "failed"].includes(envelope.deliveryStatus),
        canVoid:
          access.kind === "staff" &&
          policyEditable(app.status, task.stage) &&
          !terminal.has(envelope.state) &&
          !expired,
        canDownloadArtifact: envelope.state === "completed",
      });
    }
    return signaturesViewSchema.parse({
      simulated: true,
      canCreate:
        access.kind === "staff" && (materialInputsEditable(app.status) || app.status === "closing"),
      envelopes,
    });
  }
  async function create(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = createSignatureEnvelopeSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "INVALID_INPUT",
        400,
        "Choose a task, current document and intended signers.",
      );
    const data = parsed.data;
    return db.transaction(async (tx) => {
      const { app, userId } = await context(tx, actor, bankId, applicationId, true);
      if (closed.has(app.status)) invalid("This application is closed.");
      if (!app.synthetic && data.scenario !== "success")
        throw new DomainError(
          "INVALID_INPUT",
          400,
          "Simulation failure controls require a synthetic application.",
        );
      const payloadHash = hash({
        ...data,
        signerParticipantIds: [...data.signerParticipantIds].sort(),
      });
      const [previous] = await tx
        .select()
        .from(signatureEnvelopes)
        .where(
          and(
            eq(signatureEnvelopes.bankId, bankId),
            eq(signatureEnvelopes.applicationId, applicationId),
            eq(signatureEnvelopes.idempotencyKey, data.idempotencyKey),
          ),
        );
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request already created a different envelope.",
          );
        return view(tx, actor, bankId, applicationId);
      }
      const [task] = await tx
        .select()
        .from(applicationTasks)
        .where(
          and(
            eq(applicationTasks.id, data.taskId),
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
          ),
        );
      const [source] = await tx
        .select({ version: documentVersions, document: documents })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.id, documentVersions.documentId))
        .where(
          and(
            eq(documentVersions.id, data.sourceVersionId),
            eq(documentVersions.bankId, bankId),
            eq(documentVersions.applicationId, applicationId),
          ),
        );
      if (!task || !source) return deny();
      if (!policyEditable(app.status, task.stage))
        invalid(
          "Return the application for information before changing its signature requirements.",
        );
      const [checkInput] = await tx
        .select({ taskId: checkInputTasks.taskId })
        .from(checkInputTasks)
        .where(eq(checkInputTasks.taskId, task.id));
      if (checkInput)
        invalid("A secure identifier or tax authorization task cannot become a signature request.");
      if (
        task.state === "cancelled" ||
        source.document.currentVersion !== source.version.version ||
        source.version.uploadState !== "uploaded" ||
        source.version.scanState !== "clean"
      )
        invalid("Use an active task and its current clean document version.");
      // Restrict private source-to-task links; a public target must never reveal a private source.
      if (
        source.document.visibility === "private" &&
        (task.visibility !== "private" || task.subjectUserId !== source.document.subjectUserId)
      )
        invalid("A private source requires a task for the same private subject.");
      const [policy] = await tx
        .select()
        .from(taskSignaturePolicies)
        .where(eq(taskSignaturePolicies.taskId, task.id));
      if (policy) {
        const [old] = await tx
          .select()
          .from(signatureEnvelopes)
          .where(eq(signatureEnvelopes.id, policy.envelopeId));
        if (
          old &&
          !terminal.has(old.state) &&
          clock() < old.expiresAt &&
          (await signatureInputCurrent(tx, old))
        )
          invalid("Void the active envelope before replacing it.");
      }
      const now = clock(),
        expiresAt = data.expiresAt
          ? new Date(data.expiresAt)
          : new Date(now.getTime() + 7 * 86400000);
      if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 30 * 86400000)
        throw new DomainError(
          "INVALID_INPUT",
          400,
          "Signature expiration must be within the next 30 days.",
        );
      const [envelope] = await tx
        .insert(signatureEnvelopes)
        .values({
          bankId,
          applicationId,
          taskId: task.id,
          sourceVersionId: source.version.id,
          taskEvidenceRevision: task.evidenceRevision,
          idempotencyKey: data.idempotencyKey,
          payloadHash,
          createdByUserId: userId,
          scenario: data.scenario,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!envelope) throw new Error("Signature envelope missing.");
      for (const participantId of data.signerParticipantIds) {
        const [member] = await tx
          .select({ participant: applicationParticipants, user: users })
          .from(applicationParticipants)
          .innerJoin(users, eq(users.id, applicationParticipants.userId))
          .where(
            and(
              eq(applicationParticipants.id, participantId),
              eq(applicationParticipants.bankId, bankId),
              eq(applicationParticipants.applicationId, applicationId),
            ),
          );
        if (!member || member.participant.revokedAt || !member.user.emailVerifiedAt)
          invalid("Each intended signer must be an active verified participant.");
        const [signer] = await tx
          .insert(signatureSigners)
          .values({
            bankId,
            applicationId,
            envelopeId: envelope.id,
            participantId,
            userId: member.user.id,
            email: member.user.email,
            displayName: member.user.displayName,
            participantGenerationAt: member.participant.unassignedAt,
          })
          .returning();
        if (!signer || !(await signatureSignerEligible(tx, envelope, signer)))
          invalid("Each intended signer must have access to the task and source document.");
      }
      await tx
        .insert(taskSignaturePolicies)
        .values({ bankId, applicationId, taskId: task.id, envelopeId: envelope.id, updatedAt: now })
        .onConflictDoUpdate({
          target: taskSignaturePolicies.taskId,
          set: { envelopeId: envelope.id, updatedAt: now },
        });
      await tx
        .update(applicationTasks)
        .set({
          state: "open",
          reviewedEvidenceRevision: null,
          revision: task.revision + 1,
          updatedAt: now,
        })
        .where(eq(applicationTasks.id, task.id));
      await audit(tx, envelope, "signature.created", now, requestId, userId);
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function send(
    actor: Actor,
    bankId: string,
    applicationId: string,
    envelopeId: string,
    requestId: string,
  ) {
    return db.transaction(async (tx) => {
      const { access, userId } = await context(tx, actor, bankId, applicationId, true);
      const envelope = await load(tx, actor, access, bankId, applicationId, envelopeId);
      if (
        envelope.deliveryStatus === "pending" ||
        envelope.deliveryStatus === "running" ||
        envelope.deliveryStatus === "sent"
      )
        return view(tx, actor, bankId, applicationId);
      if (
        envelope.state !== "draft" ||
        clock() >= envelope.expiresAt ||
        !(await signatureInputCurrent(tx, envelope))
      )
        invalid("This envelope cannot be sent. Create a new request for current evidence.");
      const { signers } = await rows(tx, envelope);
      for (const signer of signers)
        if (!(await signatureSignerEligible(tx, envelope, signer)))
          invalid("An intended signer no longer has access. Create a new envelope.");
      const now = clock(),
        generation = envelope.sendGeneration + 1;
      await tx
        .update(signatureEnvelopes)
        .set({
          deliveryStatus: "pending",
          sendGeneration: generation,
          sendAttempts: 0,
          sendError: null,
          sendAvailableAt: now,
          sendClaimToken: null,
          sendLeaseUntil: null,
          updatedAt: now,
        })
        .where(eq(signatureEnvelopes.id, envelope.id));
      await tx
        .insert(signatureSendOutbox)
        .values({ envelopeId: envelope.id, generation, requestId, createdAt: now });
      await audit(tx, envelope, "signature.send_requested", now, requestId, userId);
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function act(
    actor: Actor,
    bankId: string,
    applicationId: string,
    envelopeId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = signatureActionSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Choose sign or decline.");
    return db.transaction(async (tx) => {
      const { access, userId } = await context(tx, actor, bankId, applicationId);
      const envelope = await load(tx, actor, access, bankId, applicationId, envelopeId);
      const { signers } = await rows(tx, envelope),
        signer = signers.find((s) => s.userId === userId);
      if (!signer || !(await signatureSignerEligible(tx, envelope, signer))) return deny();
      if (!(await signatureInputCurrent(tx, envelope)) || clock() >= envelope.expiresAt)
        invalid("This signature request has expired or its source has changed.");
      const state = parsed.data.action === "sign" ? "signed" : "declined";
      if (signer.state === state) return view(tx, actor, bankId, applicationId);
      if (signer.state !== "pending" || !["sent", "partially_signed"].includes(envelope.state))
        invalid("This signature request no longer accepts actions.");
      await applyEvent(
        tx,
        envelope,
        {
          eventId: randomUUID(),
          envelopeId,
          type: state === "signed" ? "signer_signed" : "signer_declined",
          signerId: signer.id,
          occurredAt: clock().toISOString(),
        },
        clock(),
        requestId,
        userId,
      );
      await recordApplicantActivity(tx, bankId, applicationId, userId, clock());
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function voidEnvelope(
    actor: Actor,
    bankId: string,
    applicationId: string,
    envelopeId: string,
    requestId: string,
  ) {
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId, true);
      const envelope = await load(tx, actor, access, bankId, applicationId, envelopeId);
      if (envelope.state === "voided") return view(tx, actor, bankId, applicationId);
      const { task } = await rows(tx, envelope);
      if (!task || !policyEditable(app.status, task.stage))
        invalid(
          "Return the application for information before changing its signature requirements.",
        );
      if (terminal.has(envelope.state) || clock() >= envelope.expiresAt)
        invalid("A terminal signature envelope cannot be voided.");
      await applyEvent(
        tx,
        envelope,
        { eventId: randomUUID(), envelopeId, type: "voided", occurredAt: clock().toISOString() },
        clock(),
        requestId,
        userId,
      );
      return view(tx, actor, bankId, applicationId);
    });
  }
  async function artifact(actor: Actor, bankId: string, applicationId: string, envelopeId: string) {
    return db.transaction(async (tx) => {
      const { access } = await context(tx, actor, bankId, applicationId);
      const envelope = await load(tx, actor, access, bankId, applicationId, envelopeId);
      const [artifact] = await tx
        .select()
        .from(signatureArtifacts)
        .where(eq(signatureArtifacts.envelopeId, envelope.id));
      if (!artifact) return deny();
      return {
        fileName: `simulated-signature-${envelope.id}.txt`,
        mimeType: "text/plain; charset=utf-8",
        body: artifact.body,
        sha256: artifact.sha256,
      };
    });
  }
  return {
    list: (actor: Actor, bankId: string, applicationId: string) =>
      db.transaction((tx) => view(tx, actor, bankId, applicationId)),
    create,
    send,
    retrySend: send,
    act,
    void: voidEnvelope,
    artifact,
  };
}
