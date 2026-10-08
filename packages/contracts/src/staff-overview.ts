import { z } from "zod";
import { documentFieldPeriodSchema, documentProcessingStateSchema } from "./document-processing.js";
import { documentScanStateSchema } from "./documents.js";
import { financialFactsViewSchema } from "./financial-facts.js";
import { taskStateSchema } from "./tasks.js";

export const staffTaxDocumentSchema = z.object({
  documentId: z.string().uuid(),
  currentVersionId: z.string().uuid(),
  displayName: z.string(),
  subjectKind: z.literal("business"),
  subjectLabel: z.string().nullable(),
  versionCount: z.number().int().positive(),
  // Actual printed period and a lender's expected period are separate facts.
  period: documentFieldPeriodSchema.nullable(),
  expectedPeriod: documentFieldPeriodSchema.nullable(),
  reviewStatus: z.enum(["reviewed", "waiting_for_review", "source_stale", "rejected"]),
  taskId: z.string().uuid().nullable(),
  taskEvidenceState: taskStateSchema.nullable(),
  scanState: documentScanStateSchema,
  processingState: documentProcessingStateSchema.nullable(),
  classificationStale: z.boolean(),
  sourceRunId: z.string().uuid().nullable(),
  acceptedFactCount: z.number().int().nonnegative(),
  staleFactCount: z.number().int().nonnegative(),
});

/** Staff-only projection. Counts never include personal evidence or replacement history as documents. */
export const staffOverviewSchema = z.object({
  applicationId: z.string().uuid(),
  applicationRevision: z.number().int().positive(),
  simulated: z.literal(true),
  financialFacts: financialFactsViewSchema,
  taxDocuments: z.object({
    documentCount: z.number().int().nonnegative(),
    versionCount: z.number().int().nonnegative(),
    reviewedCount: z.number().int().nonnegative(),
    waitingForReviewCount: z.number().int().nonnegative(),
    staleCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    currentAcceptedPeriodCount: z.number().int().nonnegative(),
    documents: z.array(staffTaxDocumentSchema),
  }),
});

export type StaffTaxDocument = z.infer<typeof staffTaxDocumentSchema>;
export type StaffOverview = z.infer<typeof staffOverviewSchema>;
