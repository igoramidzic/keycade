import { type StaffTaxDocument, staffOverviewSchema } from "@keycade/contracts";
import { applicationTasks, type Database } from "@keycade/db";
import { and, eq } from "drizzle-orm";
import { type Actor, requireApplicationAccess, requireBankStaff } from "./authorization.js";
import { lockCheckApplication } from "./checks.js";
import { createDocumentsService } from "./documents.js";
import { createFinancialFactsService } from "./financial-facts.js";

/** Reuses document access and financial-source policy in one locked application snapshot. */
export async function readStaffOverview(
  db: Pick<Database, "transaction">,
  actor: Actor,
  bankId: string,
  applicationId: string,
) {
  return db.transaction(async (tx) => {
    const app = await lockCheckApplication(tx, bankId, applicationId);
    await requireBankStaff(tx, actor, bankId);
    await requireApplicationAccess(tx, actor, bankId, applicationId);
    const financialFacts = await createFinancialFactsService(tx).read(actor, bankId, applicationId);
    const visible = await createDocumentsService(tx).list(actor, bankId, applicationId);
    const tasks = await tx
      .select({ id: applicationTasks.id, state: applicationTasks.state })
      .from(applicationTasks)
      .where(
        and(eq(applicationTasks.bankId, bankId), eq(applicationTasks.applicationId, applicationId)),
      );
    const documents: StaffTaxDocument[] = visible.documents.flatMap((document) => {
      // Personal tax records must never inflate the business tax-document group.
      if (document.subjectUserId || document.visibility === "private") return [];
      const version = document.versions.find((item) => item.id === document.currentVersionId);
      if (!version || version.uploadState !== "uploaded") return [];
      // A pending replacement/re-analysis does not erase a logical document's prior group.
      // An explicit new category (including `other`) is authoritative once available.
      const currentCategory = version.processing?.manualCategory ?? version.processing?.category;
      const previousCategory = document.versions
        .map(
          (item) =>
            item.processing?.manualCategory ??
            item.processing?.category ??
            item.processing?.history.find((run) => run.result)?.result?.category,
        )
        .find((category) => category !== undefined && category !== null);
      const classificationStale = !currentCategory && previousCategory === "tax";
      if (document.category !== "tax" && !classificationStale) return [];
      const facts = financialFacts.facts.filter((fact) => fact.source.documentId === document.id);
      const accepted = facts.filter(
        (fact) => !fact.sourceStale && fact.source.versionId === version.id,
      );
      const stale = facts.filter((fact) => fact.sourceStale);
      const reviews = financialFacts.history.filter(
        (review) =>
          review.source.documentId === document.id &&
          review.source.versionId === version.id &&
          review.source.runId === version.processing?.runId &&
          review.source.analysisRevision === version.metadata.analysisRevision &&
          review.source.categoryRevision === (version.processing?.overrides[0]?.revision ?? 0),
      );
      const periods = new Map(
        (version.processing?.extractedFields ?? []).flatMap((field) =>
          field.provenance
            ? [[JSON.stringify(field.provenance.period), field.provenance.period] as const]
            : [],
        ),
      );
      return [
        {
          documentId: document.id,
          currentVersionId: version.id,
          displayName: version.metadata.displayName ?? version.fileName,
          subjectKind: "business" as const,
          subjectLabel: app.businessName,
          versionCount: document.versions.filter((item) => item.uploadState === "uploaded").length,
          period: periods.size === 1 ? ([...periods.values()][0] ?? null) : null,
          expectedPeriod: version.metadata.expectedPeriod,
          reviewStatus:
            accepted.length > 0
              ? ("reviewed" as const)
              : stale.length > 0
                ? ("source_stale" as const)
                : reviews.length > 0 && reviews.every((review) => review.disposition === "reject")
                  ? ("rejected" as const)
                  : ("waiting_for_review" as const),
          taskId: document.taskId,
          taskEvidenceState: tasks.find((task) => task.id === document.taskId)?.state ?? null,
          scanState: version.scanState,
          processingState: document.processingState,
          classificationStale,
          sourceRunId: version.processing?.runId ?? null,
          acceptedFactCount: accepted.length,
          staleFactCount: stale.length,
        },
      ];
    });
    documents.sort(
      (left, right) =>
        (right.period?.end ?? "").localeCompare(left.period?.end ?? "") ||
        left.documentId.localeCompare(right.documentId),
    );
    const documentIds = new Set(documents.map((document) => document.documentId));
    const acceptedPeriods = new Set(
      financialFacts.facts
        .filter(
          (fact) =>
            !fact.sourceStale &&
            documentIds.has(fact.source.documentId) &&
            fact.period.basis === "fiscal_year",
        )
        .map((fact) => JSON.stringify(fact.period)),
    );
    return staffOverviewSchema.parse({
      applicationId,
      applicationRevision: financialFacts.applicationRevision,
      simulated: true,
      financialFacts,
      taxDocuments: {
        documentCount: documents.length,
        versionCount: documents.reduce((total, document) => total + document.versionCount, 0),
        reviewedCount: documents.filter((document) => document.reviewStatus === "reviewed").length,
        waitingForReviewCount: documents.filter(
          (document) => document.reviewStatus === "waiting_for_review",
        ).length,
        staleCount: documents.filter((document) => document.reviewStatus === "source_stale").length,
        rejectedCount: documents.filter((document) => document.reviewStatus === "rejected").length,
        currentAcceptedPeriodCount: acceptedPeriods.size,
        documents,
      },
    });
  });
}
