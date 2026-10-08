import { z } from "zod";
import { documentFieldPeriodSchema, extractedDocumentFieldSchema } from "./document-processing.js";

/** Keys are semantic: ordinary income, adjusted income and deposits are never interchangeable. */
export const financialMetricSchema = z.enum([
  "gross_sales",
  "returns_allowances",
  "revenue",
  "ordinary_income",
  "net_income",
  "depreciation_adjustment",
  "one_time_adjustment",
  "adjusted_net_income",
  "opening_balance",
  "closing_balance",
  "deposits",
  "withdrawals",
]);
export const financialDecimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/)
  .refine((value) => value !== "-0.00", "Use 0.00 for zero.");
export const financialFactSourceSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  runId: z.string().uuid(),
  runGeneration: z.number().int().positive(),
  categoryRevision: z.number().int().nonnegative(),
  analysisRevision: z.number().int().nonnegative(),
  sourcePage: z.number().int().positive(),
  sourceLabel: z.string(),
  recipeId: z.string(),
  recipeVersion: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const financialValueShape = {
  fieldKey: financialMetricSchema,
  label: z.string(),
  metric: financialMetricSchema,
  value: financialDecimalSchema,
  period: documentFieldPeriodSchema,
  currency: z.literal("USD"),
  unit: z.literal("money"),
  source: financialFactSourceSchema,
};
export const financialCandidateSchema = z.object({
  ...financialValueShape,
  currentFactRevision: z.number().int().nonnegative(),
  currentFactValue: financialDecimalSchema.nullable(),
  canReview: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export const financialFactReviewSchema = z.object({
  ...financialValueShape,
  id: z.string().uuid(),
  disposition: z.enum(["accept", "correct", "reject"]),
  factRevision: z.number().int().positive().nullable(),
  originalCandidate: extractedDocumentFieldSchema,
  adjustments: z.array(extractedDocumentFieldSchema),
  businessSnapshot: z.object({
    businessId: z.string().uuid().nullable(),
    businessName: z.string(),
    applicationRevision: z.number().int().positive(),
  }),
  reviewerUserId: z.string().uuid(),
  reviewedAt: z.string().datetime(),
  reason: z.string(),
  simulated: z.literal(true),
});
export const financialFactSchema = financialFactReviewSchema.extend({
  disposition: z.enum(["accept", "correct"]),
  factRevision: z.number().int().positive(),
  sourceStale: z.boolean(),
});
export const financialFactsViewSchema = z.object({
  applicationId: z.string().uuid(),
  applicationRevision: z.number().int().positive(),
  canReview: z.boolean(),
  simulated: z.literal(true),
  facts: z.array(financialFactSchema),
  history: z.array(financialFactReviewSchema),
  candidates: z.array(financialCandidateSchema),
});
export const reviewFinancialFactsSchema = z.strictObject({
  idempotencyKey: z.string().uuid(),
  expectedApplicationRevision: z.number().int().positive(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  runId: z.string().uuid(),
  expectedRunGeneration: z.number().int().positive(),
  expectedCategoryRevision: z.number().int().nonnegative(),
  expectedAnalysisRevision: z.number().int().nonnegative(),
  decisions: z
    .array(
      z
        .strictObject({
          fieldKey: financialMetricSchema,
          disposition: z.enum(["accept", "correct", "reject"]),
          expectedFactRevision: z.number().int().nonnegative(),
          value: financialDecimalSchema.optional(),
          reason: z.string().trim().min(1).max(1000),
        })
        .refine(
          (decision) => (decision.disposition === "correct") === (decision.value !== undefined),
          "Only corrections require a replacement decimal value.",
        ),
    )
    .min(1)
    .max(25)
    .refine(
      (decisions) =>
        new Set(decisions.map((decision) => decision.fieldKey)).size === decisions.length,
      "Review each field once.",
    ),
});
export type FinancialMetric = z.infer<typeof financialMetricSchema>;
export type FinancialCandidate = z.infer<typeof financialCandidateSchema>;
export type FinancialFact = z.infer<typeof financialFactSchema>;
export type FinancialFactReview = z.infer<typeof financialFactReviewSchema>;
export type FinancialFactsView = z.infer<typeof financialFactsViewSchema>;
export type ReviewFinancialFacts = z.infer<typeof reviewFinancialFactsSchema>;
