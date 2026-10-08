import {
  documentInterpretationResultSchema,
  type FinancialCandidate,
  type FinancialFact,
  type FinancialFactReview,
  type FinancialFactsView,
  financialDecimalSchema,
  financialFactsViewSchema,
  financialMetricSchema,
  reviewFinancialFactsSchema,
} from "@keycade/contracts";
import {
  applicationSetups,
  applications,
  auditEvents,
  type Database,
  type DatabaseTransaction,
  documentCategoryOverrides,
  documentMetadataRevisions,
  documentProcessingRuns,
  documents,
  documentVersions,
  financialFactCommands,
  financialFactReviews,
} from "@keycade/db";
import { and, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type Actor, type QueryDatabase, requireApplicationAccess } from "./authorization.js";
import { lockCheckApplication } from "./checks.js";
import { documentNameComparisonIsStale } from "./document-processing.js";
import { documentIsVisible } from "./documents.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";

type App = typeof applications.$inferSelect;
type Tx = DatabaseTransaction;
type Review = typeof financialFactReviews.$inferSelect;
const editable = (app: App) =>
  ["draft", "collecting_information", "needs_information"].includes(app.status);
const scope = (table: { bankId: AnyPgColumn; applicationId: AnyPgColumn }, app: App) =>
  and(eq(table.bankId, app.bankId), eq(table.applicationId, app.id));
function conflict(message = "Financial evidence changed. Reload before reviewing."): never {
  throw new DomainError("REVISION_CONFLICT", 409, message);
}
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
function key(value: {
  metric: string;
  period: { start: string; end: string; basis: string };
  currency: string;
  unit: string;
}) {
  return [
    value.metric,
    value.period.start,
    value.period.end,
    value.period.basis,
    value.currency,
    value.unit,
  ].join("|");
}
function reviewDto(row: Review): FinancialFactReview {
  const provenance = row.originalCandidate.provenance;
  if (!provenance) throw new Error("Financial fact provenance missing.");
  return {
    id: row.id,
    fieldKey: financialMetricSchema.parse(row.metric),
    metric: financialMetricSchema.parse(row.metric),
    label: row.originalCandidate.label,
    value: row.value,
    period: { start: row.periodStart, end: row.periodEnd, basis: row.basis },
    currency: "USD",
    unit: "money",
    source: {
      documentId: row.documentId,
      versionId: row.versionId,
      runId: row.runId,
      runGeneration: row.runGeneration,
      categoryRevision: row.categoryRevision,
      analysisRevision: row.analysisRevision,
      sha256: row.sha256,
      sourcePage: provenance.sourcePage,
      sourceLabel: provenance.sourceLabel,
      recipeId: provenance.recipeId,
      recipeVersion: provenance.recipeVersion,
    },
    disposition: row.disposition,
    factRevision: row.factRevision,
    originalCandidate: row.originalCandidate,
    adjustments: row.adjustments,
    businessSnapshot: row.businessSnapshot,
    reviewerUserId: row.reviewerUserId,
    reviewedAt: row.reviewedAt.toISOString(),
    reason: row.reason,
    simulated: true,
  };
}

/** Caller must already hold application access. This only projects immutable rows and current source state. */
export async function readApplicationFinancialFacts(db: QueryDatabase, app: App) {
  // Transactions share one pg client, so await queries rather than queueing concurrent work.
  const historyRows = await db
    .select()
    .from(financialFactReviews)
    .where(scope(financialFactReviews, app))
    .orderBy(desc(financialFactReviews.reviewedAt), desc(financialFactReviews.id));
  const documentRows = await db.select().from(documents).where(scope(documents, app));
  const versionRows = await db.select().from(documentVersions).where(scope(documentVersions, app));
  const runs = await db
    .select()
    .from(documentProcessingRuns)
    .where(scope(documentProcessingRuns, app))
    .orderBy(desc(documentProcessingRuns.generation));
  const overrides = await db
    .select()
    .from(documentCategoryOverrides)
    .where(scope(documentCategoryOverrides, app))
    .orderBy(desc(documentCategoryOverrides.revision));
  const metadata = await db
    .select()
    .from(documentMetadataRevisions)
    .where(scope(documentMetadataRevisions, app))
    .orderBy(desc(documentMetadataRevisions.revision));
  const history = historyRows.map(reviewDto);
  const sources = documentRows.flatMap((document) => {
    const version = versionRows.find(
      (item) => item.documentId === document.id && item.version === document.currentVersion,
    );
    if (!version) return [];
    const run = runs.find((item) => item.versionId === version.id);
    if (!run) return [];
    const override = overrides.find((item) => item.versionId === version.id);
    const meta = metadata.find((item) => item.versionId === version.id);
    const parsed = documentInterpretationResultSchema.safeParse(run.result);
    const result = parsed.success ? parsed.data : null;
    const printedBusinessNames =
      result?.extractedFields.filter((field) => field.key === "business_name") ?? [];
    const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    const subjectMatches =
      printedBusinessNames.length === 1 &&
      printedBusinessNames[0]?.kind === "text" &&
      normalizeName(printedBusinessNames[0].value) === normalizeName(app.businessName ?? "") &&
      result?.comparedApplicationBusinessName === app.businessName;
    const category = override?.category ?? result?.category;
    const reason = !editable(app)
      ? "Return this application for information before reviewing financial facts."
      : document.visibility === "private" || document.subjectUserId
        ? "Personal evidence cannot update business financial facts."
        : !app.businessName
          ? "Save the application's business name first."
          : version.uploadState !== "uploaded" || version.scanState !== "clean" || !version.sha256
            ? "The current source must finish a clean scan."
            : !["classified", "needs_review"].includes(run.state) ||
                run.stale ||
                !result ||
                result.runId !== run.id ||
                result.versionId !== version.id
              ? "The current interpretation must finish successfully."
              : documentNameComparisonIsStale(result, app.businessName)
                ? "Interpret this document again against the current business name."
                : !subjectMatches ||
                    result.findings.some((finding) => finding.code === "business_name_mismatch")
                  ? "This evidence names a different business. Request corrected evidence."
                  : null;
    return [
      {
        document,
        version,
        run,
        category,
        result,
        expectedPeriod: meta?.expectedPeriod,
        categoryRevision: override?.revision ?? 0,
        analysisRevision: meta?.analysisRevision ?? 0,
        reason,
      },
    ];
  });
  const current = new Map<string, FinancialFact>();
  for (const review of history) {
    if (review.disposition === "reject" || review.factRevision === null) continue;
    const old = current.get(key(review));
    if (old && old.factRevision >= review.factRevision) continue;
    const source = sources.find((item) => item.document.id === review.source.documentId);
    const sourceStale =
      !source ||
      source.version.id !== review.source.versionId ||
      source.run.id !== review.source.runId ||
      source.run.stale ||
      !["classified", "needs_review"].includes(source.run.state) ||
      source.version.scanState !== "clean" ||
      source.version.uploadState !== "uploaded" ||
      source.categoryRevision !== review.source.categoryRevision ||
      source.analysisRevision !== review.source.analysisRevision ||
      source.version.sha256 !== review.source.sha256 ||
      documentNameComparisonIsStale(source.result, app.businessName) ||
      review.businessSnapshot.businessName !== app.businessName ||
      review.businessSnapshot.businessId !== app.businessId;
    current.set(key(review), {
      ...review,
      disposition: review.disposition,
      factRevision: review.factRevision,
      sourceStale,
    });
  }
  const facts = [...current.values()].sort((a, b) => key(a).localeCompare(key(b)));
  const candidates: FinancialCandidate[] = sources.flatMap((source) => {
    if (!source.result) return [];
    const fieldKeys = source.result.extractedFields.map((field) => field.key);
    return source.result.extractedFields.flatMap((field) => {
      const metric = financialMetricSchema.safeParse(field.key);
      const provenance = field.provenance;
      if (
        !metric.success ||
        field.kind !== "money" ||
        !financialDecimalSchema.safeParse(field.value).success ||
        !provenance ||
        provenance.subject !== "business" ||
        provenance.currency !== "USD" ||
        !source.version.sha256
      )
        return [];
      const statement = ["opening_balance", "closing_balance", "deposits", "withdrawals"].includes(
        metric.data,
      );
      const compatible = statement
        ? source.category === "bank_statement" && provenance.period.basis === "statement"
        : ["tax", "financial_statement"].includes(source.category ?? "") &&
          provenance.period.basis === "fiscal_year";
      const candidateKey = {
        metric: metric.data,
        period: provenance.period,
        currency: "USD",
        unit: "money",
      };
      const existing = current.get(key(candidateKey));
      const unavailableReason =
        source.reason ??
        (!compatible ? "The source category and period must match this financial metric." : null) ??
        (source.expectedPeriod &&
        (source.expectedPeriod.start !== provenance.period.start ||
          source.expectedPeriod.end !== provenance.period.end ||
          source.expectedPeriod.basis !== provenance.period.basis)
          ? "The extracted period differs from the expected period. Correct the document information or provide matching evidence."
          : null) ??
        (fieldKeys.filter((item) => item === field.key).length !== 1
          ? "The interpretation contains duplicate field keys."
          : null);
      return [
        {
          ...candidateKey,
          currency: "USD" as const,
          unit: "money" as const,
          fieldKey: metric.data,
          label: field.label,
          value: field.value,
          source: {
            documentId: source.document.id,
            versionId: source.version.id,
            runId: source.run.id,
            runGeneration: source.run.generation,
            categoryRevision: source.categoryRevision,
            analysisRevision: source.analysisRevision,
            sourcePage: provenance.sourcePage,
            sourceLabel: provenance.sourceLabel,
            recipeId: provenance.recipeId,
            recipeVersion: provenance.recipeVersion,
            sha256: source.version.sha256,
          },
          currentFactRevision: existing?.factRevision ?? 0,
          currentFactValue: existing?.value ?? null,
          canReview: unavailableReason === null,
          unavailableReason,
        },
      ];
    });
  });
  return { facts, history, candidates };
}

export function createFinancialFactsService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function context(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    const app = await lockCheckApplication(tx, bankId, applicationId);
    const access = await requireApplicationAccess(tx, actor, bankId, applicationId);
    if (actor.kind !== "user" || access.kind !== "staff" || !app.synthetic) return deny();
    return { app, access, userId: actor.userId };
  }
  async function view(tx: Tx, app: App): Promise<FinancialFactsView> {
    return financialFactsViewSchema.parse({
      applicationId: app.id,
      applicationRevision: app.revision,
      canReview: editable(app),
      simulated: true,
      ...(await readApplicationFinancialFacts(tx, app)),
    });
  }
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { app } = await context(tx, actor, bankId, applicationId);
      return view(tx, app);
    });
  }
  async function review(
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const parsed = reviewFinancialFactsSchema.safeParse(raw);
    if (!parsed.success)
      throw new DomainError(
        "INVALID_INPUT",
        400,
        "Check the financial review fields and exact decimal values.",
      );
    const data = parsed.data;
    return db.transaction(async (tx) => {
      const { app, access, userId } = await context(tx, actor, bankId, applicationId);
      const payloadHash = await hashIdentityCredential(JSON.stringify(data));
      const [previous] = await tx
        .select()
        .from(financialFactCommands)
        .where(
          and(
            scope(financialFactCommands, app),
            eq(financialFactCommands.idempotencyKey, data.idempotencyKey),
          ),
        );
      if (previous) {
        if (previous.actorUserId !== userId || previous.payloadHash !== payloadHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request key was used for a different financial review.",
          );
        return financialFactsViewSchema.parse(previous.response);
      }
      if (!editable(app))
        invalid("Return this application for information before reviewing financial facts.");
      if (app.revision !== data.expectedApplicationRevision)
        conflict("The application changed. Reload before reviewing financial facts.");
      const [document] = await tx
        .select()
        .from(documents)
        .where(and(scope(documents, app), eq(documents.id, data.documentId)));
      if (!document || !(await documentIsVisible(tx, actor, access, document))) return deny();
      const [version] = await tx
        .select()
        .from(documentVersions)
        .where(
          and(
            scope(documentVersions, app),
            eq(documentVersions.documentId, document.id),
            eq(documentVersions.id, data.versionId),
          ),
        );
      const [run] = await tx
        .select()
        .from(documentProcessingRuns)
        .where(
          and(
            scope(documentProcessingRuns, app),
            eq(documentProcessingRuns.versionId, data.versionId),
            eq(documentProcessingRuns.id, data.runId),
          ),
        );
      if (!version || !run) return deny();
      const before = await view(tx, app);
      const decisions = data.decisions.map((decision) => {
        const candidate = before.candidates.find(
          (item) =>
            item.source.documentId === data.documentId && item.fieldKey === decision.fieldKey,
        );
        if (
          !candidate ||
          candidate.source.versionId !== data.versionId ||
          candidate.source.runId !== data.runId ||
          candidate.source.runGeneration !== data.expectedRunGeneration ||
          candidate.source.categoryRevision !== data.expectedCategoryRevision ||
          candidate.source.analysisRevision !== data.expectedAnalysisRevision
        )
          conflict();
        if (!candidate.canReview)
          invalid(candidate.unavailableReason ?? "This candidate cannot be reviewed.");
        if (candidate.currentFactRevision !== decision.expectedFactRevision)
          conflict(
            "A newer financial fact was accepted. Reload and explicitly review the replacement.",
          );
        const original = run.result?.extractedFields.find(
          (field) => field.key === decision.fieldKey,
        );
        if (!original?.provenance) invalid("The original candidate has no financial provenance.");
        return { decision, candidate, original };
      });
      const now = clock();
      for (const { decision, candidate, original } of decisions) {
        await tx.insert(financialFactReviews).values({
          bankId,
          applicationId,
          documentId: document.id,
          versionId: version.id,
          runId: run.id,
          runGeneration: run.generation,
          categoryRevision: candidate.source.categoryRevision,
          analysisRevision: candidate.source.analysisRevision,
          metric: candidate.metric,
          periodStart: candidate.period.start,
          periodEnd: candidate.period.end,
          basis: candidate.period.basis,
          currency: candidate.currency,
          unit: candidate.unit,
          value: decision.value ?? candidate.value,
          disposition: decision.disposition,
          factRevision:
            decision.disposition === "reject" ? null : candidate.currentFactRevision + 1,
          originalCandidate: original,
          adjustments:
            candidate.metric === "adjusted_net_income"
              ? (run.result?.extractedFields.filter((field) =>
                  ["depreciation_adjustment", "one_time_adjustment"].includes(field.key),
                ) ?? [])
              : [],
          businessSnapshot: {
            businessId: app.businessId,
            businessName: app.businessName ?? "",
            applicationRevision: app.revision,
          },
          sha256: candidate.source.sha256,
          reviewerUserId: userId,
          reason: decision.reason,
          simulated: true,
          reviewedAt: now,
        });
      }
      const [updated] = await tx
        .update(applications)
        .set({ revision: app.revision + 1, updatedAt: now })
        .where(eq(applications.id, app.id))
        .returning();
      if (!updated) conflict();
      await tx
        .update(applicationSetups)
        .set({ revision: updated.revision })
        .where(eq(applicationSetups.applicationId, app.id));
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: "application.financial_facts_reviewed",
        targetType: "document_version",
        targetId: version.id,
        changedFields: ["financialFacts", "revision"],
        requestId,
        metadata: { runId: run.id, reviewCount: data.decisions.length, simulated: true },
        createdAt: now,
      });
      // No current task/check rule consumes these facts. Future dependent rules must add invalidation here.
      const response = await view(tx, updated);
      await tx.insert(financialFactCommands).values({
        bankId,
        applicationId,
        idempotencyKey: data.idempotencyKey,
        actorUserId: userId,
        payloadHash,
        response,
        createdAt: now,
      });
      return response;
    });
  }
  return { read, review };
}
export type FinancialFactsService = ReturnType<typeof createFinancialFactsService>;
