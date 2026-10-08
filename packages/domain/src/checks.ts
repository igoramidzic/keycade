import { createHash } from "node:crypto";
import {
  authorizeTaskTaxSchema,
  businessAddressSchema,
  captureTaskIdentifierSchema,
  checksViewSchema,
  type FootprintInput,
  loanFootprintPolicyVersion,
  refreshFootprintSchema,
  resolveCheckSchema,
  retryCheckSchema,
  taxAuthorizationNotice,
  taxAuthorizationNoticeVersion,
} from "@keycade/contracts";
import {
  applicationChecks,
  applicationParticipants,
  applications,
  applicationTasks,
  auditEvents,
  businessRelationships,
  checkInputTasks,
  checkResolutions,
  checkRuns,
  type Database,
  type DatabaseTransaction,
  documents,
  documentVersions,
  enrichmentInputs,
  sensitiveIdentifierVersions,
  taskAnswers,
  taskAssignments,
} from "@keycade/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { createEnrichmentService, enrichmentSubjectActive } from "./enrichment.js";
import { DomainError, deny } from "./errors.js";
import type { IdentifierCipher } from "./identifier-cipher.js";
import { taskPasses } from "./task-rules.js";
import { createTasksService, taskIsVisible } from "./tasks.js";

type Tx = DatabaseTransaction;
type App = typeof applications.$inferSelect;
type Check = typeof applicationChecks.$inferSelect;
type Run = typeof checkRuns.$inferSelect;
type Task = typeof applicationTasks.$inferSelect;
export const materialInputsEditable = (status: string) =>
  ["draft", "collecting_information", "needs_information"].includes(status);
export const checksMayExecute = (status: string) =>
  ["draft", "collecting_information", "needs_information", "submitted", "in_review"].includes(
    status,
  );
const pending = new Set(["queued", "running", "retry_scheduled", "waiting_for_input"]);
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
function conflict(): never {
  throw new DomainError("REVISION_CONFLICT", 409, "These inputs changed. Reload before saving.");
}
function parse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  raw: unknown,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new DomainError("INVALID_INPUT", 400, "Check the synthetic input.");
  return result.data;
}
export async function lockCheckApplication(tx: Tx, bankId: string, applicationId: string) {
  const [app] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
    .for("update");
  if (!app) return deny();
  return app;
}
export function checkIsVisible(actor: Actor, access: ApplicationAccess, check: Check) {
  return (
    actor.kind === "user" &&
    (access.kind === "staff" ||
      (access.kind === "participant" &&
        check.kind !== "loan_footprint" &&
        (check.kind === "identity"
          ? check.subjectUserId === actor.userId &&
            ["owner", "applicant_admin"].includes(access.role)
          : access.role === "applicant_admin" && access.scope === "full")))
  );
}
export function checkPasses(check: Check, run: Run | undefined, resolved: boolean) {
  return (
    !!run &&
    !run.stale &&
    run.status === "succeeded" &&
    (run.result?.outcome === "clear" ||
      (run.result?.outcome === "needs_review" && check.allowReviewResolution && resolved))
  );
}
/** A fingerprint references immutable encrypted identifiers and current reviewed byte versions,
 * never plaintext. Lifecycle status/revision is deliberately excluded so submission can freeze it. */
export async function currentCheckInputs(tx: Tx, app: App, check: Check) {
  if (check.kind === "loan_footprint") {
    const parsed = businessAddressSchema.safeParse(app.businessAddress);
    const footprintInput: FootprintInput = {
      addressRevision: app.businessAddressRevision,
      address: parsed.success ? parsed.data : null,
      policyVersion: loanFootprintPolicyVersion,
    };
    const address = footprintInput.address;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          check.id,
          check.revision,
          check.policyVersion,
          app.businessAddressRevision,
          address
            ? [
                address.line1,
                address.line2 ?? null,
                address.locality,
                address.region,
                address.postalCode,
                address.countryCode,
              ]
            : null,
        ]),
      )
      .digest("hex");
    return {
      fingerprint,
      footprintInput,
      missing: parsed.success ? [] : ["business_address"],
      subjectKey: "business",
      identifierId: null,
      subjectDisplayName: null,
      subjectActive: true,
    };
  }
  const [owner] = check.subjectRelationshipId
    ? await tx
        .select()
        .from(businessRelationships)
        .where(
          and(
            eq(businessRelationships.id, check.subjectRelationshipId),
            eq(businessRelationships.bankId, app.bankId),
            eq(businessRelationships.applicationId, app.id),
          ),
        )
    : [];
  const subjectKey =
    check.kind === "fraud"
      ? "business"
      : (check.subjectUserId ?? `unlinked:${check.subjectRelationshipId}`);
  const [input] = await tx
    .select()
    .from(enrichmentInputs)
    .where(
      and(
        eq(enrichmentInputs.bankId, app.bankId),
        eq(enrichmentInputs.applicationId, app.id),
        eq(enrichmentInputs.subjectKey, subjectKey),
      ),
    );
  const [participant] = check.subjectUserId
    ? await tx
        .select()
        .from(applicationParticipants)
        .where(
          and(
            eq(applicationParticipants.bankId, app.bankId),
            eq(applicationParticipants.applicationId, app.id),
            eq(applicationParticipants.userId, check.subjectUserId),
            isNull(applicationParticipants.revokedAt),
          ),
        )
    : [];
  const subjectActive =
    check.kind === "fraud" ||
    (!!owner &&
      !owner.removedAt &&
      owner.userId === check.subjectUserId &&
      !!participant &&
      ["owner", "applicant_admin"].includes(participant.role));
  const evidence = await tx
    .select({ doc: documents, version: documentVersions, task: applicationTasks })
    .from(documents)
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.documentId, documents.id),
        eq(documentVersions.version, documents.currentVersion),
      ),
    )
    .innerJoin(applicationTasks, eq(applicationTasks.id, documents.taskId))
    .where(and(eq(documents.bankId, app.bankId), eq(documents.applicationId, app.id)))
    .orderBy(asc(documents.id));
  const relevant = evidence.filter(
    ({ task }) =>
      task.state !== "cancelled" &&
      task.required &&
      task.stage !== "closing" &&
      !task.stableKey.startsWith("check-input:") &&
      (check.kind === "identity"
        ? task.visibility === "private" && task.subjectUserId === check.subjectUserId
        : task.visibility !== "private"),
  );
  const missing: ("identifier" | "owner_access" | "reviewed_documents")[] = [];
  if (!input?.identifierId) missing.push("identifier");
  if (!subjectActive) missing.push("owner_access");
  if (
    relevant.some(
      ({ task, version }) =>
        task.state !== "waived" &&
        (!taskPasses(task) || version.uploadState !== "uploaded" || version.scanState !== "clean"),
    )
  )
    missing.push("reviewed_documents");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        check.id,
        check.revision,
        check.policyVersion,
        app.businessId,
        app.productId,
        app.businessName,
        app.requestedAmount,
        app.industryCode,
        app.industryTaxonomyVersion,
        owner
          ? [
              owner.id,
              owner.userId,
              owner.updatedAt.toISOString(),
              owner.removedAt?.toISOString() ?? null,
            ]
          : null,
        participant ? [participant.id, participant.unassignedAt?.toISOString() ?? null] : null,
        input?.identifierId ?? null,
        subjectActive,
        relevant.map(({ doc, version, task }) => [
          doc.id,
          version.id,
          version.sha256,
          version.uploadState,
          version.scanState,
          task.id,
          task.revision,
          task.evidenceRevision,
          task.reviewedEvidenceRevision,
          task.state,
        ]),
      ]),
    )
    .digest("hex");
  return {
    fingerprint,
    footprintInput: null as FootprintInput | null,
    missing,
    subjectKey,
    identifierId: input?.identifierId ?? null,
    subjectDisplayName: owner?.displayName ?? null,
    subjectActive,
  };
}
async function staleRuns(tx: Tx, checkId: string, fingerprint: string | null, now: Date) {
  const history = await tx.select().from(checkRuns).where(eq(checkRuns.checkId, checkId));
  for (const run of history)
    if (!run.stale && run.fingerprint !== fingerprint)
      await tx
        .update(checkRuns)
        .set({
          stale: true,
          status: pending.has(run.status) ? "cancelled" : run.status,
          claimToken: null,
          leaseUntil: null,
          updatedAt: now,
          errorCode: pending.has(run.status) ? "stale_input" : run.errorCode,
        })
        .where(eq(checkRuns.id, run.id));
}
async function reconcileEntryTasks(
  tx: Tx,
  app: App,
  owners: (typeof businessRelationships.$inferSelect)[],
  now: Date,
  requestId: string,
) {
  const participants = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, app.bankId),
        eq(applicationParticipants.applicationId, app.id),
        isNull(applicationParticipants.revokedAt),
      ),
    )
    .orderBy(asc(applicationParticipants.createdAt), asc(applicationParticipants.id));
  const admin = participants.find((p) => p.role === "applicant_admin" && p.scope === "full");
  const subjects = [
    {
      key: "business",
      userId: admin?.userId ?? null,
      relationshipId: null as string | null,
      title: "business",
    },
    ...owners.map((owner) => ({
      key: owner.userId ?? `unlinked:${owner.id}`,
      userId: owner.userId,
      relationshipId: owner.id,
      title: owner.displayName,
    })),
  ];
  const rows = await tx
    .select({ task: applicationTasks, link: checkInputTasks })
    .from(checkInputTasks)
    .innerJoin(applicationTasks, eq(applicationTasks.id, checkInputTasks.taskId))
    .where(and(eq(checkInputTasks.bankId, app.bankId), eq(checkInputTasks.applicationId, app.id)));
  const desired = new Set<string>();
  const storedInputs = await tx
    .select()
    .from(enrichmentInputs)
    .where(
      and(eq(enrichmentInputs.bankId, app.bankId), eq(enrichmentInputs.applicationId, app.id)),
    );
  for (const subject of subjects)
    for (const kind of ["identifier", "tax_authorization"] as const) {
      // Unlinked owners retain the T12 private readiness task; no identifier can be collected for an unverified account.
      if (!subject.userId) continue;
      const stableKey = `check-input:${kind}:${subject.relationshipId ?? "business"}`;
      desired.add(stableKey);
      const prior = rows
        .filter((row) => row.task.stableKey === stableKey)
        .sort((a, b) => b.task.occurrence - a.task.occurrence)[0];
      const participant = participants.find(
        (p) => p.userId === subject.userId && ["owner", "applicant_admin"].includes(p.role),
      );
      if (!participant) {
        desired.delete(stableKey);
        continue;
      }
      const inputFingerprint = JSON.stringify([
        subject.key,
        subject.userId,
        participant.id,
        participant.unassignedAt?.toISOString() ?? null,
      ]);
      if (
        prior &&
        prior.task.state !== "cancelled" &&
        prior.task.inputFingerprint === inputFingerprint
      ) {
        const input = storedInputs.find((input) => input.subjectKey === subject.key);
        const receiptCurrent =
          kind === "identifier"
            ? !!input?.identifierId && prior.link.capturedInputRevision === input.identifierRevision
            : !!input?.taxAuthorizedAt && prior.link.capturedInputRevision === input.revision;
        if (prior.task.state === "completed" && !receiptCurrent) {
          await tx
            .update(applicationTasks)
            .set({
              state: "open",
              revision: prior.task.revision + 1,
              reviewedEvidenceRevision: null,
              updatedAt: now,
            })
            .where(eq(applicationTasks.id, prior.task.id));
          await tx.insert(auditEvents).values({
            bankId: app.bankId,
            applicationId: app.id,
            actorType: "system",
            action: "task.private_input_superseded",
            targetType: "task",
            targetId: prior.task.id,
            requestId,
            changedFields: ["state", "reviewedEvidenceRevision"],
            metadata: { simulated: true },
            createdAt: now,
          });
        }
        continue;
      }
      if (prior && prior.task.state !== "cancelled")
        await tx
          .update(applicationTasks)
          .set({
            state: "cancelled",
            revision: prior.task.revision + 1,
            reason: "The private input subject changed.",
            updatedAt: now,
          })
          .where(eq(applicationTasks.id, prior.task.id));
      const [task] = await tx
        .insert(applicationTasks)
        .values({
          bankId: app.bankId,
          applicationId: app.id,
          stableKey,
          occurrence: (prior?.task.occurrence ?? 0) + 1,
          source: "rule",
          ruleVersion: 1,
          title:
            kind === "identifier"
              ? (subject.relationshipId
                  ? `Add synthetic personal identifier — ${subject.title}`
                  : "Add synthetic business EIN"
                ).slice(0, 160)
              : `Authorize sample tax availability — ${subject.title}`.slice(0, 160),
          description:
            kind === "identifier"
              ? "Choose a registered synthetic identifier. This private entry is encrypted; it is not a real identity determination."
              : taxAuthorizationNotice,
          reason:
            kind === "identifier"
              ? "Synthetic identity and fraud checks are required before approval, separately from submission."
              : "Optional sample tax availability requires your explicit authorization.",
          stage: "approval",
          required: kind === "identifier",
          visibility: "private",
          subjectUserId: subject.userId,
          subjectRelationshipId: subject.relationshipId,
          assigneeParticipantId: participant.unassignedAt ? null : participant.id,
          assigneeGenerationAt: null,
          inputRevision: app.revision,
          inputFingerprint,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!task) throw new Error("Private input task creation failed.");
      await tx.insert(checkInputTasks).values({
        bankId: app.bankId,
        applicationId: app.id,
        taskId: task.id,
        subjectKey: subject.key,
        kind,
        createdAt: now,
      });
      await tx.insert(taskAssignments).values({
        bankId: app.bankId,
        applicationId: app.id,
        taskId: task.id,
        participantId: participant.unassignedAt ? null : participant.id,
        createdAt: now,
      });
      await tx.insert(auditEvents).values({
        bankId: app.bankId,
        applicationId: app.id,
        actorType: "system",
        action: "task.created",
        targetType: "task",
        targetId: task.id,
        requestId,
        metadata: { simulated: true, source: "private_input" },
        createdAt: now,
      });
    }
  for (const { task } of rows)
    if (task.state !== "cancelled" && !desired.has(task.stableKey))
      await tx
        .update(applicationTasks)
        .set({
          state: "cancelled",
          revision: task.revision + 1,
          reason: "This private input is no longer required for the current participant.",
          updatedAt: now,
        })
        .where(eq(applicationTasks.id, task.id));
}
/** Informational address checks can be added/refreshed even on frozen legacy applications.
 * They never change application revisions, required subjects, or decision evidence. */
export async function reconcileFootprint(tx: Tx, app: App, requestId: string, now: Date) {
  if (!app.synthetic) return;
  let [check] = await tx
    .select()
    .from(applicationChecks)
    .where(
      and(
        eq(applicationChecks.bankId, app.bankId),
        eq(applicationChecks.applicationId, app.id),
        eq(applicationChecks.stableKey, "loan_footprint:business"),
      ),
    );
  if (!check)
    [check] = await tx
      .insert(applicationChecks)
      .values({
        bankId: app.bankId,
        applicationId: app.id,
        stableKey: "loan_footprint:business",
        kind: "loan_footprint",
        required: false,
        allowReviewResolution: false,
        policyVersion: loanFootprintPolicyVersion,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  if (!check) throw new Error("Footprint check was not stored.");
  let inputs = await currentCheckInputs(tx, app, check);
  const [old] = await tx
    .select()
    .from(checkRuns)
    .where(and(eq(checkRuns.checkId, check.id), eq(checkRuns.fingerprint, inputs.fingerprint)));
  if (old?.stale) {
    const [next] = await tx
      .update(applicationChecks)
      .set({ revision: check.revision + 1, updatedAt: now })
      .where(eq(applicationChecks.id, check.id))
      .returning();
    if (!next) throw new Error("Footprint generation was not stored.");
    check = next;
    inputs = await currentCheckInputs(tx, app, check);
  }
  await staleRuns(tx, check.id, inputs.fingerprint, now);
  await tx
    .insert(checkRuns)
    .values({
      bankId: app.bankId,
      applicationId: app.id,
      checkId: check.id,
      fingerprint: inputs.fingerprint,
      subjectKey: "business",
      footprintInput: inputs.footprintInput,
      status: inputs.missing.length ? "waiting_for_input" : "queued",
      missingPrerequisites: inputs.missing,
      requestId,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}
/** Caller holds the application lock. Durable run rows and private tasks are one transaction. */
export async function reconcileChecks(
  tx: Tx,
  bankId: string,
  applicationId: string,
  requestId: string,
  now: Date,
) {
  const app = await lockCheckApplication(tx, bankId, applicationId);
  if (!app.synthetic) return;
  await reconcileFootprint(tx, app, requestId, now);
  if (!checksMayExecute(app.status)) return;
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
    )
    .orderBy(asc(businessRelationships.id));
  const desired = [
    {
      stableKey: "fraud:business",
      kind: "fraud" as const,
      subjectUserId: null as string | null,
      subjectRelationshipId: null as string | null,
    },
    ...owners.map((o) => ({
      stableKey: `identity:${o.id}`,
      kind: "identity" as const,
      subjectUserId: o.userId,
      subjectRelationshipId: o.id,
    })),
  ];
  const checks = await tx
    .select()
    .from(applicationChecks)
    .where(
      and(eq(applicationChecks.bankId, bankId), eq(applicationChecks.applicationId, applicationId)),
    );
  // Reconciliation may observe current inputs during review, but cannot add/remove frozen policy subjects.
  if (materialInputsEditable(app.status)) {
    for (const check of checks)
      if (
        check.kind !== "loan_footprint" &&
        check.active &&
        !desired.some((d) => d.stableKey === check.stableKey)
      ) {
        await tx
          .update(applicationChecks)
          .set({ active: false, revision: check.revision + 1, updatedAt: now })
          .where(eq(applicationChecks.id, check.id));
        await staleRuns(tx, check.id, null, now);
      }
    await reconcileEntryTasks(tx, app, owners, now, requestId);
  }
  for (const target of desired) {
    let check = checks.find((c) => c.stableKey === target.stableKey);
    if (!check && materialInputsEditable(app.status))
      [check] = await tx
        .insert(applicationChecks)
        .values({ ...target, bankId, applicationId, createdAt: now, updatedAt: now })
        .returning();
    if (
      check &&
      materialInputsEditable(app.status) &&
      (!check.active || check.subjectUserId !== target.subjectUserId)
    )
      [check] = await tx
        .update(applicationChecks)
        .set({
          active: true,
          subjectUserId: target.subjectUserId,
          revision: check.revision + 1,
          updatedAt: now,
        })
        .where(eq(applicationChecks.id, check.id))
        .returning();
    if (!check?.active) continue;
    let inputs = await currentCheckInputs(tx, app, check);
    const [previousGeneration] = await tx
      .select()
      .from(checkRuns)
      .where(and(eq(checkRuns.checkId, check.id), eq(checkRuns.fingerprint, inputs.fingerprint)));
    // Returning facts to an earlier value must not revive an invalidated generation.
    if (previousGeneration?.stale) {
      const [next] = await tx
        .update(applicationChecks)
        .set({ revision: check.revision + 1, updatedAt: now })
        .where(eq(applicationChecks.id, check.id))
        .returning();
      if (!next) throw new Error("Check input generation was not stored.");
      check = next;
      inputs = await currentCheckInputs(tx, app, check);
    }
    await staleRuns(tx, check.id, inputs.fingerprint, now);
    await tx
      .insert(checkRuns)
      .values({
        bankId,
        applicationId,
        checkId: check.id,
        fingerprint: inputs.fingerprint,
        subjectKey: inputs.subjectKey,
        identifierId: inputs.identifierId,
        status: inputs.missing.length ? "waiting_for_input" : "queued",
        missingPrerequisites: inputs.missing,
        requestId,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}
export async function hydrateSecureTaskInputs(
  tx: Tx,
  app: { status: string },
  access: ApplicationAccess,
  tasks: Task[],
) {
  if (!tasks.length) return new Map();
  const rows = await tx
    .select({
      link: checkInputTasks,
      input: enrichmentInputs,
      masked: sensitiveIdentifierVersions.maskedValue,
    })
    .from(checkInputTasks)
    .leftJoin(
      enrichmentInputs,
      and(
        eq(enrichmentInputs.bankId, checkInputTasks.bankId),
        eq(enrichmentInputs.applicationId, checkInputTasks.applicationId),
        eq(enrichmentInputs.subjectKey, checkInputTasks.subjectKey),
      ),
    )
    .leftJoin(
      sensitiveIdentifierVersions,
      eq(sensitiveIdentifierVersions.id, enrichmentInputs.identifierId),
    )
    .where(
      inArray(
        checkInputTasks.taskId,
        tasks.map((t) => t.id),
      ),
    );
  const map = new Map<
    string,
    {
      inputKind:
        | "synthetic_business_identifier"
        | "synthetic_personal_identifier"
        | "tax_authorization";
      secureInput: {
        revision: number;
        identifierPresent: boolean;
        identifierMasked: string | null;
        taxAuthorized: boolean;
        noticeVersion: typeof taxAuthorizationNoticeVersion;
        notice: typeof taxAuthorizationNotice;
        canEdit: boolean;
      };
    }
  >();
  for (const row of rows) {
    const task = tasks.find((t) => t.id === row.link.taskId);
    const own =
      access.kind === "staff" ||
      (access.kind === "participant" &&
        task?.assigneeParticipantId === access.participantId &&
        (task?.assigneeGenerationAt?.getTime() ?? null) ===
          (access.unassignedAt?.getTime() ?? null));
    map.set(row.link.taskId, {
      inputKind:
        row.link.kind === "tax_authorization"
          ? "tax_authorization"
          : row.link.subjectKey === "business"
            ? "synthetic_business_identifier"
            : "synthetic_personal_identifier",
      secureInput: {
        revision: row.input?.revision ?? 0,
        identifierPresent: !!row.input?.identifierId,
        identifierMasked: row.masked,
        taxAuthorized:
          !!row.input?.taxAuthorizedAt && (await enrichmentSubjectActive(tx, row.input, "tax")),
        noticeVersion: taxAuthorizationNoticeVersion,
        notice: taxAuthorizationNotice,
        canEdit: own && task?.state !== "cancelled" && materialInputsEditable(app.status),
      },
    });
  }
  return map;
}
async function view(tx: Tx, actor: Actor, app: App, access: ApplicationAccess) {
  const rows = await tx
    .select()
    .from(applicationChecks)
    .where(
      and(
        eq(applicationChecks.bankId, app.bankId),
        eq(applicationChecks.applicationId, app.id),
        eq(applicationChecks.active, true),
      ),
    )
    .orderBy(
      asc(applicationChecks.kind),
      asc(applicationChecks.createdAt),
      asc(applicationChecks.id),
    );
  const checks = rows.filter((check) => checkIsVisible(actor, access, check));
  const staff = access.kind === "staff";
  const mutable = staff && checksMayExecute(app.status);
  const checkViews = [];
  for (const check of checks) {
    const inputs = await currentCheckInputs(tx, app, check);
    const history = await tx
      .select({ run: checkRuns, resolution: checkResolutions })
      .from(checkRuns)
      .leftJoin(checkResolutions, eq(checkResolutions.runId, checkRuns.id))
      .where(eq(checkRuns.checkId, check.id))
      .orderBy(asc(checkRuns.stale), desc(checkRuns.createdAt), desc(checkRuns.id))
      .limit(50);
    const current = history.find(({ run }) => !run.stale && run.fingerprint === inputs.fingerprint);
    const run = current?.run;
    checkViews.push({
      id: check.id,
      kind: check.kind,
      title:
        check.kind === "loan_footprint"
          ? "Loan Footprint"
          : check.kind === "fraud"
            ? "Simulated business fraud check"
            : `Simulated owner identity check — ${inputs.subjectDisplayName ?? "owner"}`,
      stage: check.stage,
      required: check.required,
      subjectUserId: check.subjectUserId,
      subjectRelationshipId: check.subjectRelationshipId,
      currentRunId: run?.id ?? null,
      passes: checkPasses(check, run, !!current?.resolution),
      canRefresh:
        staff &&
        check.kind === "loan_footprint" &&
        !!run &&
        !inputs.missing.length &&
        !pending.has(run.status),
      canRetry:
        mutable && !!run && ["failed", "timed_out"].includes(run.status) && run.attempts < 28,
      canResolve:
        mutable &&
        !!run &&
        run.status === "succeeded" &&
        run.result?.outcome === "needs_review" &&
        check.allowReviewResolution &&
        !current?.resolution,
      runs: history.map(({ run, resolution }) => ({
        id: run.id,
        status: run.status,
        stale: run.stale || run.fingerprint !== inputs.fingerprint,
        attempts: run.attempts,
        missingPrerequisites: run.missingPrerequisites,
        outcome: run.result?.outcome ?? null,
        evidence: staff ? run.result : null,
        footprintInput: staff ? run.footprintInput : null,
        errorCode: staff ? run.errorCode : null,
        resolved: !!resolution,
        resolution:
          staff && resolution
            ? {
                reason: resolution.reason,
                resolvedByUserId: resolution.resolvedByUserId,
                createdAt: resolution.createdAt.toISOString(),
              }
            : null,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      })),
    });
  }
  return checksViewSchema.parse({
    applicationId: app.id,
    simulated: true,
    canManage: staff,
    checks: checkViews,
  });
}
export function createChecksService(
  db: Pick<Database, "transaction">,
  options: { cipher: IdentifierCipher; clock?: () => Date },
) {
  const clock = options.clock ?? (() => new Date());
  async function context(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    const app = await lockCheckApplication(tx, bankId, applicationId);
    const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user" || !app.synthetic) return deny();
    return { app, access, userId: actor.userId };
  }
  async function capture(
    actor: Actor,
    bankId: string,
    applicationId: string,
    taskId: string,
    raw: unknown,
    requestId: string,
    kind: "identifier" | "tax_authorization",
  ) {
    const parsed =
      kind === "identifier"
        ? parse(captureTaskIdentifierSchema, raw)
        : parse(authorizeTaskTaxSchema, raw);
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId);
      const [row] = await tx
        .select({ task: applicationTasks, link: checkInputTasks })
        .from(applicationTasks)
        .innerJoin(checkInputTasks, eq(checkInputTasks.taskId, applicationTasks.id))
        .where(
          and(
            eq(applicationTasks.bankId, bankId),
            eq(applicationTasks.applicationId, applicationId),
            eq(applicationTasks.id, taskId),
          ),
        )
        .for("update");
      if (!row || !taskIsVisible(actor, access, row.task) || row.link.kind !== kind) return deny();
      if (
        access.kind !== "staff" &&
        !(
          access.kind === "participant" &&
          row.task.assigneeParticipantId === access.participantId &&
          (row.task.assigneeGenerationAt?.getTime() ?? null) ===
            (access.unassignedAt?.getTime() ?? null)
        )
      )
        return deny();
      if (!materialInputsEditable(app.status) || row.task.state === "cancelled")
        invalid("This application is not accepting identifier changes.");
      if (row.task.revision !== parsed.expectedRevision) conflict();
      const subject =
        row.link.subjectKey === "business" ? {} : { subjectUserId: row.link.subjectKey };
      const enrichment = createEnrichmentService(tx, { cipher: options.cipher, clock });
      const saved =
        kind === "identifier"
          ? await enrichment.saveIdentifier(
              actor,
              bankId,
              applicationId,
              {
                ...subject,
                expectedRevision: parsed.expectedInputRevision,
                value: parse(captureTaskIdentifierSchema, raw).value,
              },
              requestId,
            )
          : await enrichment.authorizeTax(
              actor,
              bankId,
              applicationId,
              {
                ...subject,
                expectedRevision: parsed.expectedInputRevision,
                authorized: parse(authorizeTaskTaxSchema, raw).authorized,
                noticeVersion: taxAuthorizationNoticeVersion,
              },
              requestId,
            );
      const complete = kind === "identifier" || saved.taxAuthorization.authorized;
      const evidenceRevision = row.task.evidenceRevision + 1;
      await tx
        .update(applicationTasks)
        .set({
          state: complete ? "completed" : "open",
          revision: row.task.revision + 1,
          evidenceRevision,
          reviewedEvidenceRevision: complete ? evidenceRevision : null,
          updatedAt: clock(),
        })
        .where(eq(applicationTasks.id, taskId));
      await tx.insert(taskAnswers).values({
        bankId,
        applicationId,
        taskId,
        evidenceRevision,
        answer:
          kind === "identifier"
            ? "Synthetic identifier saved"
            : complete
              ? "Sample tax authorization granted"
              : "Sample tax authorization revoked",
        authorUserId: userId,
        createdAt: clock(),
      });
      await tx
        .update(checkInputTasks)
        .set({
          capturedInputRevision: kind === "identifier" ? saved.identifier.revision : saved.revision,
        })
        .where(eq(checkInputTasks.taskId, taskId));
      if (kind === "identifier") {
        const siblings = await tx
          .select({ task: applicationTasks, link: checkInputTasks })
          .from(checkInputTasks)
          .innerJoin(applicationTasks, eq(applicationTasks.id, checkInputTasks.taskId))
          .where(
            and(
              eq(checkInputTasks.bankId, bankId),
              eq(checkInputTasks.applicationId, applicationId),
              eq(checkInputTasks.subjectKey, row.link.subjectKey),
              eq(checkInputTasks.kind, "tax_authorization"),
            ),
          );
        for (const { task } of siblings)
          if (task.state !== "cancelled")
            await tx
              .update(applicationTasks)
              .set({
                state: "open",
                revision: task.revision + 1,
                reviewedEvidenceRevision: null,
                updatedAt: clock(),
              })
              .where(eq(applicationTasks.id, task.id));
      } else if (complete)
        await enrichment.requestRun(
          actor,
          bankId,
          applicationId,
          { ...subject, kind: "tax", expectedRevision: saved.revision },
          requestId,
        );
      await reconcileChecks(tx, bankId, applicationId, requestId, clock());
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: kind === "identifier" ? "task.identifier_saved" : "task.tax_authorization_saved",
        targetType: "task",
        targetId: taskId,
        requestId,
        changedFields: ["evidenceRevision", "state"],
        metadata: { simulated: true },
        createdAt: clock(),
      });
      return createTasksService(tx, { clock }).read(actor, bankId, applicationId);
    });
  }
  async function staffAction(
    actor: Actor,
    bankId: string,
    applicationId: string,
    checkId: string,
    raw: unknown,
    requestId: string,
    resolve: boolean,
  ) {
    const parsed = resolve ? parse(resolveCheckSchema, raw) : parse(retryCheckSchema, raw);
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId);
      if (access.kind !== "staff") return deny();
      const [check] = await tx
        .select()
        .from(applicationChecks)
        .where(
          and(
            eq(applicationChecks.bankId, bankId),
            eq(applicationChecks.applicationId, applicationId),
            eq(applicationChecks.id, checkId),
          ),
        );
      if (!check) return deny();
      const [run] = await tx
        .select()
        .from(checkRuns)
        .where(and(eq(checkRuns.id, parsed.runId), eq(checkRuns.checkId, checkId)));
      const inputs = await currentCheckInputs(tx, app, check);
      if (
        !check.active ||
        !run ||
        run.stale ||
        run.fingerprint !== inputs.fingerprint ||
        !checksMayExecute(app.status)
      )
        invalid("This check no longer has current actionable inputs.");
      if (resolve) {
        if (
          run.status !== "succeeded" ||
          run.result?.outcome !== "needs_review" ||
          !check.allowReviewResolution
        )
          invalid("Only a permitted current review finding can be resolved.");
        const [resolution] = await tx
          .insert(checkResolutions)
          .values({
            bankId,
            applicationId,
            checkId,
            runId: run.id,
            reason: "reviewed_synthetic_evidence",
            resolvedByUserId: userId,
            createdAt: clock(),
          })
          .onConflictDoNothing()
          .returning();
        if (!resolution) return view(tx, actor, app, access);
      } else {
        if (!["failed", "timed_out"].includes(run.status) || run.attempts >= 28)
          invalid("This check cannot be retried.");
        await tx
          .update(checkRuns)
          .set({
            status: "queued",
            maxAttempts: run.attempts + 3,
            availableAt: clock(),
            claimToken: null,
            leaseUntil: null,
            errorCode: null,
            updatedAt: clock(),
          })
          .where(eq(checkRuns.id, run.id));
      }
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: resolve ? "check.resolved" : "check.retried",
        targetType: "check_run",
        targetId: run.id,
        requestId,
        metadata: { simulated: true, reason: parsed.reason },
        createdAt: clock(),
      });
      return view(tx, actor, app, access);
    });
  }
  return {
    async read(actor: Actor, bankId: string, applicationId: string) {
      return db.transaction(async (tx) => {
        const { app, access } = await context(tx, actor, bankId, applicationId);
        await reconcileChecks(tx, bankId, applicationId, "checks-read", clock());
        return view(tx, actor, app, access);
      });
    },
    captureIdentifier: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      raw: unknown,
      requestId: string,
    ) => capture(actor, bankId, applicationId, taskId, raw, requestId, "identifier"),
    authorizeTax: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      taskId: string,
      raw: unknown,
      requestId: string,
    ) => capture(actor, bankId, applicationId, taskId, raw, requestId, "tax_authorization"),
    async refresh(
      actor: Actor,
      bankId: string,
      applicationId: string,
      checkId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(refreshFootprintSchema, raw);
      return db.transaction(async (tx) => {
        const { app, access, userId } = await context(tx, actor, bankId, applicationId);
        if (access.kind !== "staff") return deny();
        const [check] = await tx
          .select()
          .from(applicationChecks)
          .where(
            and(
              eq(applicationChecks.id, checkId),
              eq(applicationChecks.bankId, bankId),
              eq(applicationChecks.applicationId, applicationId),
            ),
          );
        if (!check || check.kind !== "loan_footprint" || !check.active) return deny();
        const [run] = await tx
          .select()
          .from(checkRuns)
          .where(and(eq(checkRuns.id, parsed.runId), eq(checkRuns.checkId, check.id)));
        if (!run) return deny();
        if (
          app.businessAddressRevision !== parsed.expectedAddressRevision ||
          run.footprintInput?.addressRevision !== parsed.expectedAddressRevision
        )
          conflict();
        const [replay] = await tx
          .select()
          .from(checkRuns)
          .where(eq(checkRuns.refreshOfRunId, run.id));
        if (replay) return view(tx, actor, app, access);
        const inputs = await currentCheckInputs(tx, app, check);
        if (
          run.stale ||
          run.fingerprint !== inputs.fingerprint ||
          inputs.missing.length ||
          pending.has(run.status)
        )
          invalid("This footprint does not have current refreshable inputs.");
        await tx
          .update(applicationChecks)
          .set({ revision: check.revision + 1, updatedAt: clock() })
          .where(eq(applicationChecks.id, check.id));
        await reconcileFootprint(tx, app, requestId, clock());
        const [next] = await tx
          .select()
          .from(checkRuns)
          .where(and(eq(checkRuns.checkId, check.id), eq(checkRuns.stale, false)));
        if (!next) throw new Error("Footprint refresh intent was not stored.");
        await tx.update(checkRuns).set({ refreshOfRunId: run.id }).where(eq(checkRuns.id, next.id));
        await tx.insert(auditEvents).values({
          bankId,
          applicationId,
          actorType: "user",
          actorUserId: userId,
          action: "check.refreshed",
          targetType: "check_run",
          targetId: next.id,
          requestId,
          metadata: {
            simulated: true,
            kind: "loan_footprint",
            addressRevision: parsed.expectedAddressRevision,
          },
          createdAt: clock(),
        });
        return view(tx, actor, app, access);
      });
    },
    retry: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      checkId: string,
      raw: unknown,
      requestId: string,
    ) => staffAction(actor, bankId, applicationId, checkId, raw, requestId, false),
    resolve: (
      actor: Actor,
      bankId: string,
      applicationId: string,
      checkId: string,
      raw: unknown,
      requestId: string,
    ) => staffAction(actor, bankId, applicationId, checkId, raw, requestId, true),
  };
}
export type ChecksService = ReturnType<typeof createChecksService>;
