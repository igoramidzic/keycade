import { documentProcessingViewSchema } from "@keycade/contracts";
import {
  applications,
  applicationTasks,
  auditEvents,
  type DatabaseTransaction,
  documentCategoryOverrides,
  documentProcessingOutbox,
  documentProcessingRuns,
  documents,
  documentVersions,
} from "@keycade/db";
import { desc, eq } from "drizzle-orm";
import { type Actor, type ApplicationAccess } from "./authorization.js";
import { taskIsVisible } from "./tasks.js";

type Version = typeof documentVersions.$inferSelect;
type Document = typeof documents.$inferSelect;
const closed = new Set(["funded", "declined", "withdrawn"]);

/** A result's comparison is contextual; retained PDF interpretation is not a lasting name verdict. */
export function documentNameComparisonIsStale(
  result: typeof documentProcessingRuns.$inferSelect.result,
  businessName: string | null,
) {
  if (
    !result?.findings?.some(
      (finding) =>
        finding.code === "business_name_match" || finding.code === "business_name_mismatch",
    )
  )
    return false;
  return (
    !result.comparedApplicationBusinessName ||
    result.comparedApplicationBusinessName !== businessName
  );
}

/** Caller owns the application lock. Processing intent is committed with the clean scan or retry. */
export async function enqueueDocumentProcessing(
  tx: DatabaseTransaction,
  versionId: string,
  options: { now: Date; requestId: string; requestedByUserId?: string; reprocess?: boolean },
) {
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId));
  if (!version || version.uploadState !== "uploaded" || version.scanState !== "clean") return null;
  const [document] = await tx.select().from(documents).where(eq(documents.id, version.documentId));
  const [app] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, version.applicationId));
  if (!document || document.currentVersion !== version.version || !app || closed.has(app.status))
    return null;
  const [previous] = await tx
    .select()
    .from(documentProcessingRuns)
    .where(eq(documentProcessingRuns.versionId, versionId))
    .orderBy(desc(documentProcessingRuns.generation))
    .limit(1);
  if (
    previous &&
    (!options.reprocess || (!previous.stale && ["queued", "processing"].includes(previous.state)))
  )
    return previous;
  const [run] = await tx
    .insert(documentProcessingRuns)
    .values({
      bankId: version.bankId,
      applicationId: version.applicationId,
      versionId,
      generation: (previous?.generation ?? 0) + 1,
      requestedByUserId: options.requestedByUserId ?? null,
      requestId: options.requestId,
      availableAt: options.now,
      createdAt: options.now,
      updatedAt: options.now,
    })
    .returning();
  if (!run) throw new Error("Document processing intent creation failed.");
  await tx.insert(documentProcessingOutbox).values({
    bankId: run.bankId,
    applicationId: run.applicationId,
    runId: run.id,
    createdAt: options.now,
  });
  await tx.insert(auditEvents).values({
    bankId: run.bankId,
    applicationId: run.applicationId,
    actorType: options.requestedByUserId ? "user" : "system",
    actorUserId: options.requestedByUserId ?? null,
    action: options.reprocess ? "document.processing_retried" : "document.processing_queued",
    targetType: "document_version",
    targetId: version.id,
    requestId: options.requestId,
    changedFields: ["processingState"],
    metadata: { runId: run.id, generation: run.generation, simulated: true },
    createdAt: options.now,
  });
  return run;
}

/** Machine matches remain suggestions and are projected through the reader's current task scope. */
export function projectDocumentProcessing(
  actor: Actor,
  access: ApplicationAccess,
  document: Document,
  version: Version,
  rows: {
    runs: (typeof documentProcessingRuns.$inferSelect)[];
    overrides: (typeof documentCategoryOverrides.$inferSelect)[];
    tasks: (typeof applicationTasks.$inferSelect)[];
  },
  options: {
    writable: boolean;
    closed: boolean;
    businessName: string | null;
    metadataEditable: boolean;
  },
) {
  const { runs, overrides } = rows;
  const latest = runs[0];
  if (!latest) return null;
  const result = latest.stale ? null : latest.result;
  const comparisonStale =
    latest.lastErrorCode === "stale_business_name" ||
    documentNameComparisonIsStale(latest.result, options.businessName);
  const currentClean =
    document.currentVersion === version.version &&
    version.uploadState === "uploaded" &&
    version.scanState === "clean" &&
    !options.closed;
  const tasks = result ? rows.tasks : [];
  const matches = tasks.filter((task) => {
    if (task.state === "cancelled" || !taskIsVisible(actor, access, task)) return false;
    if (document.visibility === "private" && task.subjectUserId !== document.subjectUserId)
      return false;
    if (document.visibility !== "private" && task.visibility === "private") return false;
    if (document.taskId === task.id) return true;
    const text = `${task.stableKey} ${task.title}`.toLowerCase();
    return (
      (result?.category === "tax" && /tax|identifier/.test(text)) ||
      (result?.category === "bank_statement" && /bank.statement/.test(text)) ||
      (result?.category === "financial_statement" && /financial.statement/.test(text)) ||
      (result?.category === "business_legal" && /entity|business.legal/.test(text)) ||
      (result?.category === "identification" && /owner.confirmation|identity/.test(text))
    );
  });
  return documentProcessingViewSchema.parse({
    runId: latest.id,
    state: comparisonStale ? "needs_review" : latest.state,
    simulated: true,
    category: result?.category ?? null,
    confidence: result?.confidence ?? null,
    extractedFields: result?.extractedFields ?? [],
    findings: comparisonStale
      ? [
          ...(result?.findings ?? []).filter(
            (finding) =>
              finding.code !== "business_name_match" && finding.code !== "business_name_mismatch",
          ),
          {
            code: "document_review",
            severity: "warning",
            title: "Business name check needs refresh",
            detail:
              "The application business name changed after this simulated comparison. Interpret this document again to review its name against the current application. The original result remains in history.",
          },
        ]
      : (result?.findings ?? []),
    suggestedTasks: matches.map(({ id, title }) => ({ id, title })),
    manualCategory: overrides[0]?.category ?? null,
    overrides: overrides.map((override) => ({
      ...override,
      createdAt: override.createdAt.toISOString(),
    })),
    history: runs.map((run) => ({
      ...run,
      stale: run.stale || documentNameComparisonIsStale(run.result, options.businessName),
      errorCode: run.lastErrorCode,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
    errorCode: comparisonStale ? "stale_business_name" : latest.lastErrorCode,
    canRetry:
      currentClean &&
      options.writable &&
      (comparisonStale ||
        latest.state === "failed" ||
        (access.kind === "staff" && ["classified", "needs_review"].includes(latest.state))),
    canCorrectCategory: currentClean && access.kind === "staff" && options.metadataEditable,
  });
}
