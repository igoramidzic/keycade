import {
  approveApplicationSchema,
  declineApplicationSchema,
  type ReviewReasonCode,
  requestInformationSchema,
  reviewReasonLabels,
  reviewViewSchema,
  startReviewSchema,
  submitApplicationSchema,
  withdrawApplicationSchema,
} from "@keycade/contracts";
import {
  applicationChecks,
  applicationDecisions,
  applicationRequirementPolicies,
  applicationReviewCommands,
  applicationReviewEvents,
  applicationSetups,
  applicationSubmissions,
  applications,
  applicationTasks,
  auditEvents,
  businesses,
  businessRelationships,
  checkResolutions,
  checkRuns,
  type Database,
  type DatabaseTransaction,
  documentProcessingOutbox,
  documentProcessingRuns,
  documents,
  documentVersions,
  enrichmentInputs,
  enrichmentRuns,
  integrationRuns,
  loanProducts,
  notifications,
  type SubmissionSnapshot,
  signatureEnvelopes,
  signatureSendOutbox,
  signatureSigners,
  taskReviews,
  taskSignaturePolicies,
} from "@keycade/db";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type Actor, type ApplicationAccess, requireApplicationAccess } from "./authorization.js";
import { lockCheckApplication } from "./checks.js";
import { DomainError, deny } from "./errors.js";
import { readApplicationFinancialFacts } from "./financial-facts.js";
import { hashIdentityCredential } from "./identity.js";
import {
  queueApplicationStatusNotifications,
  queueTaskNotification,
  recordApplicantActivity,
} from "./notification-intents.js";
import { evaluateReadiness } from "./readiness.js";
import { reconcileTasks } from "./tasks.js";

type Tx = DatabaseTransaction;
type App = typeof applications.$inferSelect;
type Action = typeof applicationReviewEvents.$inferSelect.action;
const terminal = new Set(["funded", "declined", "withdrawn"]);
const pending = ["waiting_for_input", "queued", "running", "retry_scheduled"] as const;
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
function conflict(): never {
  throw new DomainError("REVISION_CONFLICT", 409, "The application changed. Reload and try again.");
}
function scope(table: { bankId: AnyPgColumn; applicationId: AnyPgColumn }, app: App) {
  return and(eq(table.bankId, app.bankId), eq(table.applicationId, app.id));
}

async function accessFor(tx: Tx, actor: Actor, app: App) {
  const access = await requireApplicationAccess(tx, actor, app.bankId, app.id);
  if (
    actor.kind !== "user" ||
    !app.synthetic ||
    !(
      access.kind === "staff" ||
      (access.kind === "participant" &&
        access.role === "applicant_admin" &&
        access.scope === "full")
    )
  )
    return deny();
  return { access, userId: actor.userId };
}
/** Snapshot only explicit facts and references. Live shared-business updates are never used to rewrite it. */
async function capture(tx: Tx, app: App): Promise<SubmissionSnapshot> {
  const financialFacts = (await readApplicationFinancialFacts(tx, app)).facts.map((fact) => ({
    id: fact.id,
    revision: fact.factRevision,
    metric: fact.metric,
    period: fact.period,
    currency: fact.currency,
    unit: fact.unit,
    value: fact.value,
    source: fact.source,
    sourceStale: fact.sourceStale,
  }));
  const [business] = await tx
    .select()
    .from(businesses)
    .where(and(eq(businesses.bankId, app.bankId), eq(businesses.id, app.businessId ?? app.id)));
  const [product] = await tx
    .select()
    .from(loanProducts)
    .where(and(eq(loanProducts.bankId, app.bankId), eq(loanProducts.id, app.productId ?? app.id)));
  if (!business || !product || !app.businessName || !app.requestedAmount)
    invalid("Complete business and loan details first.");
  const owners = await tx
    .select({
      id: businessRelationships.id,
      kind: businessRelationships.kind,
      userId: businessRelationships.userId,
      displayName: businessRelationships.displayName,
      ownershipPercent: businessRelationships.ownershipPercent,
    })
    .from(businessRelationships)
    .where(and(scope(businessRelationships, app), isNull(businessRelationships.removedAt)))
    .orderBy(asc(businessRelationships.id));
  const tasks = await tx
    .select()
    .from(applicationTasks)
    .where(and(scope(applicationTasks, app), ne(applicationTasks.state, "cancelled")))
    .orderBy(asc(applicationTasks.id));
  const evidence = await tx
    .select({
      documentId: documents.id,
      taskId: documents.taskId,
      versionId: documentVersions.id,
      sha256: documentVersions.sha256,
      visibility: documents.visibility,
      subjectUserId: documents.subjectUserId,
    })
    .from(documents)
    .leftJoin(
      documentVersions,
      and(
        eq(documentVersions.documentId, documents.id),
        eq(documentVersions.version, documents.currentVersion),
      ),
    )
    .where(scope(documents, app))
    .orderBy(asc(documents.id));
  const identifiers = await tx
    .select({
      subjectKey: enrichmentInputs.subjectKey,
      identifierId: enrichmentInputs.identifierId,
      identifierRevision: enrichmentInputs.identifierRevision,
      inputRevision: enrichmentInputs.revision,
      taxAuthorizedAt: enrichmentInputs.taxAuthorizedAt,
    })
    .from(enrichmentInputs)
    .where(scope(enrichmentInputs, app))
    .orderBy(asc(enrichmentInputs.subjectKey));
  const checks = await tx
    .select({ check: applicationChecks, run: checkRuns, resolution: checkResolutions })
    .from(applicationChecks)
    .leftJoin(
      checkRuns,
      and(eq(checkRuns.checkId, applicationChecks.id), eq(checkRuns.stale, false)),
    )
    .leftJoin(checkResolutions, eq(checkResolutions.runId, checkRuns.id))
    .where(
      and(
        scope(applicationChecks, app),
        eq(applicationChecks.active, true),
        inArray(applicationChecks.kind, ["identity", "fraud"]),
      ),
    )
    .orderBy(asc(applicationChecks.id));
  const [policy] = await tx
    .select()
    .from(applicationRequirementPolicies)
    .where(scope(applicationRequirementPolicies, app));
  const signatures = await tx
    .select({
      id: signatureEnvelopes.id,
      taskId: signatureEnvelopes.taskId,
      sourceVersionId: signatureEnvelopes.sourceVersionId,
      state: signatureEnvelopes.state,
      stale: signatureEnvelopes.stale,
      completedEvidenceRevision: signatureEnvelopes.completedEvidenceRevision,
    })
    .from(signatureEnvelopes)
    .where(scope(signatureEnvelopes, app))
    .orderBy(asc(signatureEnvelopes.id));
  const legacyFacts = {
    businessName: app.businessName,
    productName: product.name,
    requestedAmount: app.requestedAmount,
    currency: "USD" as const,
    purpose: app.purpose,
    industryCode: app.industryCode,
    industryTaxonomyVersion: app.industryTaxonomyVersion,
  };
  const facts = {
    ...legacyFacts,
    businessAddress: app.businessAddress,
    businessAddressRevision: app.businessAddressRevision,
    website: app.website,
    fundingPurposes: app.fundingPurposes,
    purposeCatalogVersion: app.purposeCatalogVersion,
    otherPurposeDetail: app.otherPurposeDetail,
  };
  // Retain the original material hash for historical submissions whose added fields
  // are all absent. Populating any v2 fact becomes material drift, requiring resubmission.
  const fingerprintFacts =
    app.businessAddress ||
    app.businessAddressRevision ||
    app.website ||
    app.fundingPurposes.length ||
    app.purposeCatalogVersion ||
    app.otherPurposeDetail
      ? facts
      : legacyFacts;
  const signaturePolicies = await tx
    .select({ taskId: taskSignaturePolicies.taskId, envelopeId: taskSignaturePolicies.envelopeId })
    .from(taskSignaturePolicies)
    .where(scope(taskSignaturePolicies, app))
    .orderBy(asc(taskSignaturePolicies.taskId));
  const signers = await tx
    .select({
      id: signatureSigners.id,
      envelopeId: signatureSigners.envelopeId,
      participantId: signatureSigners.participantId,
      userId: signatureSigners.userId,
      participantGenerationAt: signatureSigners.participantGenerationAt,
    })
    .from(signatureSigners)
    .where(scope(signatureSigners, app))
    .orderBy(asc(signatureSigners.id));
  const requirements = tasks.map((t) => ({
    id: t.id,
    stableKey: t.stableKey,
    occurrence: t.occurrence,
    ruleVersion: t.ruleVersion,
    stage: t.stage,
    required: t.required,
    visibility: t.visibility,
    subjectUserId: t.subjectUserId,
    inputFingerprint: t.inputFingerprint,
    evidenceRevision: signaturePolicies.some((p) => p.taskId === t.id) ? null : t.evidenceRevision,
  }));
  const materialFingerprint = await hashIdentityCredential(
    JSON.stringify({
      application: { businessId: app.businessId, productId: app.productId, ...fingerprintFacts },
      owners,
      signaturePolicies,
      signers,
      requirements,
      identifiers,
      evidence,
      ...(financialFacts.length ? { financialFacts } : {}),
    }),
  );
  return {
    facts,
    businessProfile: {
      id: business.id,
      legalName: business.legalName,
      industryCode: business.industryCode,
      revision: business.revision,
    },
    materialFingerprint,
    references: {
      productId: product.id,
      policy: policy
        ? { ruleSetId: policy.ruleSetId, version: policy.version, rules: policy.rules }
        : null,
      owners,
      identifiers,
      documents: evidence,
      financialFacts,
      signaturePolicies,
      signers,
      tasks: tasks.map((t) => ({
        ...requirements.find((r) => r.id === t.id),
        revision: t.revision,
        state: t.state,
        reviewedEvidenceRevision: t.reviewedEvidenceRevision,
      })),
      checks: checks.map(({ check, run, resolution }) => ({
        id: check.id,
        policyVersion: check.policyVersion,
        stage: check.stage,
        required: check.required,
        runId: run?.id ?? null,
        fingerprint: run?.fingerprint ?? null,
        status: run?.status ?? null,
        outcome: run?.result?.outcome ?? null,
        resolutionId: resolution?.id ?? null,
      })),
      signatures,
    },
  };
}
async function view(tx: Tx, actor: Actor, app: App, access: ApplicationAccess) {
  const staff = access.kind === "staff";
  const readiness = await evaluateReadiness(tx, app, staff ? undefined : { actor, access });
  const submissions = await tx
    .select()
    .from(applicationSubmissions)
    .where(scope(applicationSubmissions, app))
    .orderBy(desc(applicationSubmissions.sequence));
  const decisions = await tx
    .select()
    .from(applicationDecisions)
    .where(scope(applicationDecisions, app))
    .orderBy(desc(applicationDecisions.createdAt));
  const history = await tx
    .select()
    .from(applicationReviewEvents)
    .where(scope(applicationReviewEvents, app))
    .orderBy(desc(applicationReviewEvents.applicationRevision));
  const tasks = staff
    ? await tx
        .select({
          id: applicationTasks.id,
          title: applicationTasks.title,
          stage: applicationTasks.stage,
        })
        .from(applicationTasks)
        .where(and(scope(applicationTasks, app), ne(applicationTasks.state, "cancelled")))
    : [];
  return reviewViewSchema.parse({
    applicationId: app.id,
    revision: app.revision,
    status: app.status,
    simulated: true,
    canManage: staff,
    capabilities: {
      submit: ["collecting_information", "needs_information"].includes(app.status),
      startReview: staff && app.status === "submitted",
      requestInformation: staff && app.status === "in_review",
      approve: staff && app.status === "in_review",
      decline: staff && app.status === "in_review",
      withdraw: !terminal.has(app.status),
    },
    readiness,
    requestableTasks: tasks,
    submissions: submissions.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      createdAt: s.createdAt.toISOString(),
      submittedByUserId: staff ? s.submittedByUserId : null,
      submittedOnBehalf: s.snapshot.references.submittedOnBehalf === true,
      facts: s.snapshot.facts,
    })),
    decisions: decisions.map((d) => ({
      id: d.id,
      submissionId: d.submissionId,
      outcome: d.outcome,
      approvedAmount: d.approvedAmount,
      currency: d.currency,
      reasonCode: d.reasonCode,
      publicReason: reviewReasonLabels[d.reasonCode as ReviewReasonCode],
      privateNote: staff ? d.privateNote : null,
      decidedByUserId: staff ? d.decidedByUserId : null,
      createdAt: d.createdAt.toISOString(),
    })),
    history: history.map((e) => ({
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      revision: e.applicationRevision,
      reasonCode: e.reasonCode,
      publicReason: e.reasonCode ? reviewReasonLabels[e.reasonCode as ReviewReasonCode] : null,
      privateNote: staff ? e.privateNote : null,
      actorUserId: staff ? e.actorUserId : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
async function cancelWork(tx: Tx, app: App, now: Date) {
  await tx
    .update(checkRuns)
    .set({ status: "cancelled", stale: true, claimToken: null, leaseUntil: null, updatedAt: now })
    .where(and(scope(checkRuns, app), inArray(checkRuns.status, [...pending])));
  await tx
    .update(enrichmentRuns)
    .set({ status: "cancelled", stale: true, claimToken: null, leaseUntil: null, updatedAt: now })
    .where(and(scope(enrichmentRuns, app), inArray(enrichmentRuns.status, [...pending])));
  await tx
    .update(integrationRuns)
    .set({ status: "cancelled", stale: true, claimToken: null, leaseUntil: null, updatedAt: now })
    .where(and(scope(integrationRuns, app), inArray(integrationRuns.status, [...pending])));
  const envelopes = await tx
    .update(signatureEnvelopes)
    .set({
      state: "voided",
      sendGeneration: sql`${signatureEnvelopes.sendGeneration}+1`,
      sendClaimToken: null,
      sendLeaseUntil: null,
      deliveryStatus: "not_sent",
      updatedAt: now,
    })
    .where(
      and(
        scope(signatureEnvelopes, app),
        inArray(signatureEnvelopes.state, ["draft", "sent", "partially_signed"]),
      ),
    )
    .returning({ id: signatureEnvelopes.id });
  if (envelopes.length)
    await tx
      .update(signatureSendOutbox)
      .set({ dispatchedAt: now })
      .where(
        inArray(
          signatureSendOutbox.envelopeId,
          envelopes.map((e) => e.id),
        ),
      );
  await tx
    .update(documentProcessingRuns)
    .set({
      state: "failed",
      stale: true,
      claimToken: null,
      leaseUntil: null,
      lastErrorCode: "application_closed",
      updatedAt: now,
    })
    .where(
      and(
        scope(documentProcessingRuns, app),
        inArray(documentProcessingRuns.state, ["queued", "processing"]),
      ),
    );
  await tx
    .update(documentProcessingOutbox)
    .set({ dispatchedAt: now })
    .where(
      and(scope(documentProcessingOutbox, app), isNull(documentProcessingOutbox.dispatchedAt)),
    );
  await tx
    .update(notifications)
    .set({ state: "suppressed", suppressedAt: now, suppressionReason: "application_closed" })
    .where(
      and(
        scope(notifications, app),
        inArray(notifications.state, ["pending", "queued"]),
        inArray(notifications.kind, [
          "reminder",
          "task_assigned",
          "task_returned",
          "signature_requested",
        ]),
      ),
    );
}
export function createReviewService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access } = await accessFor(tx, actor, app);
      await reconcileTasks(tx, bankId, applicationId, "review-read", clock());
      return view(tx, actor, app, access);
    });
  }
  async function mutate(
    action: Action,
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const schema =
      action === "submit"
        ? submitApplicationSchema
        : action === "start_review"
          ? startReviewSchema
          : action === "request_information"
            ? requestInformationSchema
            : action === "approve"
              ? approveApplicationSchema
              : action === "decline"
                ? declineApplicationSchema
                : withdrawApplicationSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid review action.");
    const data = parsed.data as {
      expectedRevision: number;
      idempotencyKey: string;
      reasonCode?: ReviewReasonCode;
      privateNote?: string;
    };
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access, userId } = await accessFor(tx, actor, app);
      const staff = access.kind === "staff";
      if (!staff && action !== "submit" && action !== "withdraw") return deny();
      if (!staff && "privateNote" in data && data.privateNote) return deny();
      const payloadHash = await hashIdentityCredential(JSON.stringify(data));
      const [previous] = await tx
        .select()
        .from(applicationReviewCommands)
        .where(
          and(
            scope(applicationReviewCommands, app),
            eq(applicationReviewCommands.idempotencyKey, data.idempotencyKey),
          ),
        );
      if (previous) {
        if (
          previous.actorUserId !== userId ||
          previous.action !== action ||
          previous.payloadHash !== payloadHash
        )
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request key was used for a different review action.",
          );
        return view(tx, actor, app, access);
      }
      if (app.revision !== data.expectedRevision) conflict();
      const allowed =
        action === "submit"
          ? ["collecting_information", "needs_information"]
          : action === "start_review"
            ? ["submitted"]
            : action === "withdraw"
              ? [
                  "draft",
                  "collecting_information",
                  "needs_information",
                  "submitted",
                  "in_review",
                  "approved",
                  "closing",
                ]
              : ["in_review"];
      if (!allowed.includes(app.status))
        invalid("This review action is unavailable at the current application stage.");
      const now = clock();
      await reconcileTasks(tx, bankId, applicationId, requestId, now);
      const [currentSubmission] = await tx
        .select()
        .from(applicationSubmissions)
        .where(scope(applicationSubmissions, app))
        .orderBy(desc(applicationSubmissions.sequence))
        .limit(1);
      let submissionId = currentSubmission?.id ?? null;
      if (action !== "submit" && action !== "withdraw" && !currentSubmission)
        invalid("A current submission is required before review.");
      if (action === "submit" || action === "approve") {
        const readiness = await evaluateReadiness(tx, app);
        const gate = readiness.gates.find(
          (g) => g.stage === (action === "submit" ? "submission" : "approval"),
        );
        if (!gate?.ready)
          invalid(
            staff
              ? `Required items remain: ${gate?.blockers.map((b) => b.title).join(", ") ?? "requirements unavailable"}.`
              : "Required application items remain. Complete the outstanding requirements before submitting.",
          );
      }
      const nextStatus: App["status"] =
        action === "submit"
          ? "submitted"
          : action === "start_review"
            ? "in_review"
            : action === "request_information"
              ? "needs_information"
              : action === "approve"
                ? "approved"
                : action === "decline"
                  ? "declined"
                  : "withdrawn";
      let snapshot: SubmissionSnapshot | undefined;
      if (action === "submit" || action === "approve" || action === "decline")
        snapshot = await capture(tx, app);
      if (action === "submit" && snapshot) {
        snapshot.references.submittedOnBehalf = staff;
        const [submission] = await tx
          .insert(applicationSubmissions)
          .values({
            bankId,
            applicationId,
            sequence: (currentSubmission?.sequence ?? 0) + 1,
            applicationRevision: app.revision + 1,
            submittedByUserId: userId,
            snapshot,
            createdAt: now,
          })
          .returning();
        submissionId = submission?.id ?? null;
      }
      if ((action === "approve" || action === "decline") && snapshot && currentSubmission) {
        if (snapshot.materialFingerprint !== currentSubmission.snapshot.materialFingerprint)
          invalid(
            "Material inputs changed after submission. Request information and obtain a fresh submission.",
          );
        let amount: string | null = null;
        if (action === "approve") {
          const approval = approveApplicationSchema.parse(data);
          amount = approval.approvedAmount;
          const [product] = await tx
            .select()
            .from(loanProducts)
            .where(
              and(eq(loanProducts.bankId, bankId), eq(loanProducts.id, app.productId ?? app.id)),
            );
          const cents = BigInt(amount.replace(".", ""));
          if (
            !product ||
            cents <= 0n ||
            cents < BigInt(product.minimumAmount.replace(".", "")) ||
            cents > BigInt(product.maximumAmount.replace(".", "")) ||
            cents > BigInt(currentSubmission.snapshot.facts.requestedAmount.replace(".", ""))
          )
            invalid(
              "Approved amount must be within the product bounds and cannot exceed the submitted requested amount.",
            );
        }
        await tx.insert(applicationDecisions).values({
          bankId,
          applicationId,
          submissionId: currentSubmission.id,
          applicationRevision: app.revision + 1,
          outcome: action === "approve" ? "approved" : "declined",
          approvedAmount: amount,
          reasonCode: data.reasonCode ?? "demo_criteria_met",
          privateNote: "privateNote" in data ? (data.privateNote ?? null) : null,
          decidedByUserId: userId,
          evidence: snapshot.references,
          createdAt: now,
        });
      }
      if (action === "request_information") {
        const info = requestInformationSchema.parse(data);
        const tasks = await tx
          .select()
          .from(applicationTasks)
          .where(
            and(
              scope(applicationTasks, app),
              inArray(applicationTasks.id, info.taskIds),
              ne(applicationTasks.state, "cancelled"),
            ),
          )
          .for("update");
        if (tasks.length !== info.taskIds.length) return deny();
        for (const task of tasks) {
          await tx
            .update(applicationTasks)
            .set({
              state: "needs_changes",
              revision: task.revision + 1,
              reviewedEvidenceRevision: null,
              updatedAt: now,
            })
            .where(eq(applicationTasks.id, task.id));
          await queueTaskNotification(
            tx,
            {
              ...task,
              state: "needs_changes",
              revision: task.revision + 1,
              reviewedEvidenceRevision: null,
              updatedAt: now,
            },
            "task.review",
            now,
          );
          await tx.insert(taskReviews).values({
            bankId,
            applicationId,
            taskId: task.id,
            evidenceRevision: task.evidenceRevision,
            taskRevision: task.revision + 1,
            decision: "needs_changes",
            reason: reviewReasonLabels[info.reasonCode],
            reviewerUserId: userId,
            createdAt: now,
          });
          await tx.insert(auditEvents).values({
            bankId,
            applicationId,
            actorType: "user",
            actorUserId: userId,
            action: "task.returned_for_information",
            targetType: "task",
            targetId: task.id,
            changedFields: ["state", "reviewedEvidenceRevision"],
            requestId,
            metadata: { revision: task.revision + 1 },
            createdAt: now,
          });
        }
      }
      const reasonCode = data.reasonCode ?? null;
      const privateNote = "privateNote" in data ? (data.privateNote ?? null) : null;
      const [updated] = await tx
        .update(applications)
        .set({
          status: nextStatus,
          revision: app.revision + 1,
          assignedStaffId: action === "start_review" ? userId : app.assignedStaffId,
          updatedAt: now,
        })
        .where(and(eq(applications.id, app.id), eq(applications.revision, app.revision)))
        .returning();
      if (!updated) conflict();
      await tx
        .update(applicationSetups)
        .set({ revision: updated.revision })
        .where(eq(applicationSetups.applicationId, app.id));
      const [event] = await tx
        .insert(applicationReviewEvents)
        .values({
          bankId,
          applicationId,
          submissionId,
          action,
          fromStatus: app.status,
          toStatus: nextStatus,
          applicationRevision: updated.revision,
          actorUserId: userId,
          reasonCode,
          privateNote,
          taskIds:
            action === "request_information" ? requestInformationSchema.parse(data).taskIds : [],
          createdAt: now,
        })
        .returning();
      if (!event) throw new Error("Review event insert failed.");
      await tx.insert(applicationReviewCommands).values({
        bankId,
        applicationId,
        idempotencyKey: data.idempotencyKey,
        actorUserId: userId,
        action,
        payloadHash,
        eventId: event.id,
        createdAt: now,
      });
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: `application.${action}`,
        targetType: "application",
        targetId: app.id,
        changedFields: ["status", "revision"],
        requestId,
        metadata: { revision: updated.revision, submissionId, reasonCode },
        createdAt: now,
      });
      if (action === "withdraw" || action === "decline") await cancelWork(tx, updated, now);
      await recordApplicantActivity(tx, bankId, applicationId, userId, now);
      await queueApplicationStatusNotifications(tx, bankId, applicationId, updated.revision, now);
      return view(tx, actor, updated, access);
    });
  }
  return {
    read,
    submit: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("submit", a, b, c, d, e),
    startReview: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("start_review", a, b, c, d, e),
    requestInformation: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("request_information", a, b, c, d, e),
    approve: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("approve", a, b, c, d, e),
    decline: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("decline", a, b, c, d, e),
    withdraw: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("withdraw", a, b, c, d, e),
  };
}
export type ReviewService = ReturnType<typeof createReviewService>;
