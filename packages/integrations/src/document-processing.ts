import { randomUUID } from "node:crypto";
import { documentInterpretationResultSchema } from "@keycade/contracts";
import {
  applications,
  auditEvents,
  type Database,
  type DatabaseTransaction,
  documentProcessingOutbox,
  documentProcessingRuns,
  documents,
  documentVersions,
} from "@keycade/db";
import { enqueueDocumentProcessing } from "@keycade/domain";
import { and, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { interpretSyntheticDocument } from "./document-interpretation.js";
import { type Clock, ProviderError, systemClock } from "./provider.js";

const closed = new Set(["withdrawn", "declined", "funded"]);
async function currentInput(tx: Pick<DatabaseTransaction, "select">, versionId: string) {
  const [row] = await tx
    .select({ version: documentVersions, document: documents, application: applications })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(applications, eq(applications.id, documentVersions.applicationId))
    .where(eq(documentVersions.id, versionId));
  if (
    !row ||
    row.version.uploadState !== "uploaded" ||
    row.version.scanState !== "clean" ||
    !row.version.sha256 ||
    row.document.currentVersion !== row.version.version ||
    closed.has(row.application.status)
  )
    return null;
  return row;
}

/** Backfill only clean current versions from before T14, preserving one initial intent per version. */
export async function reconcileDocumentProcessing(db: Database, now = new Date()) {
  const candidates = await db
    .select({ id: documentVersions.id, applicationId: documentVersions.applicationId })
    .from(documentVersions)
    .innerJoin(
      documents,
      and(
        eq(documents.id, documentVersions.documentId),
        eq(documents.currentVersion, documentVersions.version),
      ),
    )
    .leftJoin(documentProcessingRuns, eq(documentProcessingRuns.versionId, documentVersions.id))
    .innerJoin(applications, eq(applications.id, documentVersions.applicationId))
    .where(
      and(
        eq(documentVersions.uploadState, "uploaded"),
        eq(documentVersions.scanState, "clean"),
        isNull(documentProcessingRuns.id),
        notInArray(applications.status, ["funded", "declined", "withdrawn"]),
      ),
    )
    .limit(20);
  for (const candidate of candidates)
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, candidate.applicationId))
        .for("update");
      await enqueueDocumentProcessing(tx, candidate.id, { now, requestId: randomUUID() });
    });
}

/** Leased dispatch consumes the transactional outbox directly on both local and scheduled runtimes. */
export async function processDocumentInterpretations(
  db: Database,
  options: {
    clock?: Clock;
    delayMs?: number;
    deadlineMs?: number;
    retryBaseMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const clock = options.clock ?? systemClock;
  const delayMs = options.delayMs ?? 7000;
  const deadlineMs = options.deadlineMs ?? 60_000;
  const retryBaseMs = options.retryBaseMs ?? 1000;
  await reconcileDocumentProcessing(db, clock.now());
  const claim = await db.transaction(async (tx) => {
    const now = clock.now();
    const [run] = await tx
      .select()
      .from(documentProcessingRuns)
      .where(
        and(
          inArray(documentProcessingRuns.state, ["queued", "processing"]),
          eq(documentProcessingRuns.stale, false),
          lte(documentProcessingRuns.availableAt, now),
          or(
            isNull(documentProcessingRuns.leaseUntil),
            lte(documentProcessingRuns.leaseUntil, now),
          ),
          inArray(
            documentProcessingRuns.id,
            tx.select({ id: documentProcessingOutbox.runId }).from(documentProcessingOutbox),
          ),
        ),
      )
      .orderBy(documentProcessingRuns.availableAt, documentProcessingRuns.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!run) return null;
    if (run.attempts >= run.maxAttempts) {
      await tx
        .update(documentProcessingRuns)
        .set({
          state: "failed",
          lastErrorCode: "retry_limit",
          claimToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(eq(documentProcessingRuns.id, run.id));
      return { exhausted: true as const };
    }
    const token = randomUUID();
    await tx
      .update(documentProcessingRuns)
      .set({
        state: "processing",
        claimToken: token,
        leaseUntil: new Date(now.getTime() + deadlineMs + 30_000),
        attempts: sql`${documentProcessingRuns.attempts}+1`,
        updatedAt: now,
      })
      .where(eq(documentProcessingRuns.id, run.id));
    await tx
      .update(documentProcessingOutbox)
      .set({ dispatchedAt: now })
      .where(
        and(
          eq(documentProcessingOutbox.runId, run.id),
          isNull(documentProcessingOutbox.dispatchedAt),
        ),
      );
    return { ...run, token, attempt: run.attempts + 1, exhausted: false as const };
  });
  if (!claim) return false;
  if (claim.exhausted) return true;
  const input = await currentInput(db, claim.versionId);
  if (!input) {
    await db
      .update(documentProcessingRuns)
      .set({
        state: "failed",
        stale: true,
        lastErrorCode: "stale_input",
        claimToken: null,
        leaseUntil: null,
        updatedAt: clock.now(),
      })
      .where(
        and(
          eq(documentProcessingRuns.id, claim.id),
          eq(documentProcessingRuns.claimToken, claim.token),
        ),
      );
    return true;
  }
  try {
    const result = documentInterpretationResultSchema.parse(
      await interpretSyntheticDocument(
        {
          runId: claim.id,
          versionId: claim.versionId,
          bankId: claim.bankId,
          applicationId: claim.applicationId,
          sha256: input.version.sha256 ?? "",
          attempt: claim.attempt,
          businessName: input.application.businessName,
        },
        { clock, delayMs, deadlineMs, signal: options.signal },
      ),
    );
    if (result.runId !== claim.id || result.versionId !== claim.versionId)
      throw new ProviderError("terminal_error", false);
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, claim.applicationId))
        .for("update");
      const [run] = await tx
        .select()
        .from(documentProcessingRuns)
        .where(
          and(
            eq(documentProcessingRuns.id, claim.id),
            eq(documentProcessingRuns.claimToken, claim.token),
          ),
        )
        .for("update");
      if (!run) return;
      const [latest] = await tx
        .select()
        .from(documentProcessingRuns)
        .where(eq(documentProcessingRuns.versionId, claim.versionId))
        .orderBy(desc(documentProcessingRuns.generation))
        .limit(1);
      const current = await currentInput(tx, claim.versionId);
      const nameChanged =
        result.comparedApplicationBusinessName !== null &&
        current?.application.businessName !== input.application.businessName;
      const stale = !current || latest?.id !== claim.id || nameChanged;
      const state =
        result.needsReview || result.confidence < 0.8
          ? ("needs_review" as const)
          : ("classified" as const);
      await tx
        .update(documentProcessingRuns)
        .set({
          state,
          result,
          stale,
          lastErrorCode: stale
            ? nameChanged && current
              ? "stale_business_name"
              : "stale_input"
            : null,
          claimToken: null,
          leaseUntil: null,
          updatedAt: clock.now(),
        })
        .where(eq(documentProcessingRuns.id, claim.id));
      await tx.insert(auditEvents).values({
        bankId: claim.bankId,
        applicationId: claim.applicationId,
        actorType: "system",
        action: stale ? "document.processing_stale" : "document.processed",
        targetType: "document_version",
        targetId: claim.versionId,
        requestId: claim.requestId,
        changedFields: ["processingState"],
        metadata: { runId: claim.id, simulated: true, provider: result.provider, state, stale },
        createdAt: clock.now(),
      });
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const retryable =
      error instanceof ProviderError && error.retryable && claim.attempt < claim.maxAttempts;
    const code = error instanceof ProviderError ? error.code : "invalid_provider_result";
    await db.transaction(async (tx) => {
      const [changed] = await tx
        .update(documentProcessingRuns)
        .set({
          state: retryable ? "queued" : "failed",
          lastErrorCode: code,
          claimToken: null,
          leaseUntil: null,
          availableAt: new Date(clock.now().getTime() + retryBaseMs * 2 ** (claim.attempt - 1)),
          updatedAt: clock.now(),
        })
        .where(
          and(
            eq(documentProcessingRuns.id, claim.id),
            eq(documentProcessingRuns.claimToken, claim.token),
          ),
        )
        .returning();
      if (!changed) return;
      await tx.insert(auditEvents).values({
        bankId: claim.bankId,
        applicationId: claim.applicationId,
        actorType: "system",
        action: retryable ? "document.processing_retry_scheduled" : "document.processing_failed",
        targetType: "document_version",
        targetId: claim.versionId,
        requestId: claim.requestId,
        metadata: { runId: claim.id, errorCode: code, simulated: true },
        createdAt: clock.now(),
      });
    });
  }
  return true;
}
