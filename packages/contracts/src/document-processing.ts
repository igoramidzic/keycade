import { z } from "zod";

export const documentCategorySchema = z.enum([
  "tax",
  "bank_statement",
  "financial_statement",
  "business_legal",
  "identification",
  "signed",
  "other",
]);
export const documentCategoryLabels = {
  tax: "Tax documents",
  bank_statement: "Bank statements",
  financial_statement: "Financial statements",
  business_legal: "Business/legal",
  identification: "Identification",
  signed: "Signed documents",
  other: "Other",
} as const;
export const documentProcessingStateSchema = z.enum([
  "queued",
  "processing",
  "classified",
  "needs_review",
  "failed",
]);
export const documentFieldPeriodSchema = z
  .strictObject({
    start: z.iso.date(),
    end: z.iso.date(),
    basis: z.enum(["fiscal_year", "statement"]),
  })
  .refine((period) => period.start <= period.end, "A period must end on or after its start.");
export const extractedFieldProvenanceSchema = z.strictObject({
  recipeId: z.enum([
    "business-tax-return-2023",
    "business-tax-return-2024",
    "business-tax-return-2025",
    "business-bank-statement-2026-01",
    "business-tax-return-review",
  ]),
  recipeVersion: z.literal(1),
  sourcePage: z.number().int().min(1).max(2),
  sourceLabel: z.string().min(1).max(120),
  period: documentFieldPeriodSchema,
  currency: z.literal("USD").nullable(),
  subject: z.literal("business"),
  supplied: z.literal(true),
});
export const extractedDocumentFieldSchema = z
  .strictObject({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    value: z.string().max(500),
    kind: z.enum(["text", "money", "year"]),
    provenance: extractedFieldProvenanceSchema.optional(),
  })
  .refine(
    (field) =>
      field.kind === "money"
        ? /^\d{1,18}\.\d{2}$/.test(field.value)
        : field.kind === "year"
          ? /^\d{4}$/.test(field.value)
          : true,
    "Extracted values must match their declared type.",
  )
  .refine(
    (field) =>
      !field.provenance ||
      (field.kind === "money"
        ? field.provenance.currency === "USD"
        : field.provenance.currency === null),
    "Currency must match the supplied field type.",
  );
export type ExtractedDocumentField = z.infer<typeof extractedDocumentFieldSchema>;
export const documentFindingSchema = z.strictObject({
  code: z.enum(["business_name_match", "business_name_mismatch", "cash_flow", "document_review"]),
  severity: z.enum(["clear", "warning"]),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(1000),
});
export const documentInterpretationResultSchema = z.strictObject({
  provider: z.literal("keycade-document-interpretation-v1"),
  simulated: z.literal(true),
  runId: z.string().uuid(),
  versionId: z.string().uuid(),
  category: documentCategorySchema,
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  extractedFields: z.array(extractedDocumentFieldSchema).max(25),
  findings: z.array(documentFindingSchema).max(10).default([]),
  comparedApplicationBusinessName: z.string().min(1).max(200).nullable().default(null),
  demoImportFixture: z
    .strictObject({
      recipeId: z.enum([
        "business-tax-return-2023",
        "business-tax-return-2024",
        "business-tax-return-2025",
        "business-bank-statement-2026-01",
        "business-tax-return-review",
      ]),
      recipeVersion: z.literal(1),
      businessName: z.string().min(1).max(200),
      applicationRevision: z.number().int().nonnegative(),
    })
    .optional(),
  completedAt: z.string().datetime(),
});
export const correctDocumentCategorySchema = z.strictObject({
  versionId: z.string().uuid(),
  category: documentCategorySchema,
  reason: z.string().trim().min(1).max(1000),
});
export const documentCategoryOverrideSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  category: documentCategorySchema,
  reason: z.string(),
  actorUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export const documentProcessingRunSchema = z.object({
  id: z.string().uuid(),
  generation: z.number().int().positive(),
  state: documentProcessingStateSchema,
  attempts: z.number().int().nonnegative(),
  stale: z.boolean(),
  result: documentInterpretationResultSchema.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const documentProcessingViewSchema = z.object({
  runId: z.string().uuid(),
  state: documentProcessingStateSchema,
  simulated: z.literal(true),
  category: documentCategorySchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  extractedFields: z.array(extractedDocumentFieldSchema),
  findings: z.array(documentFindingSchema).max(10).default([]),
  suggestedTasks: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
  manualCategory: documentCategorySchema.nullable(),
  overrides: z.array(documentCategoryOverrideSchema),
  history: z.array(documentProcessingRunSchema),
  errorCode: z.string().nullable(),
  canRetry: z.boolean(),
  canCorrectCategory: z.boolean(),
});
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
export type DocumentFinding = z.infer<typeof documentFindingSchema>;
export type DocumentInterpretationResult = z.infer<typeof documentInterpretationResultSchema>;
export type DocumentProcessingView = z.infer<typeof documentProcessingViewSchema>;
export type CorrectDocumentCategory = z.infer<typeof correctDocumentCategorySchema>;
