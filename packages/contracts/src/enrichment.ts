import { z } from "zod";

export const taxAuthorizationNoticeVersion = "demo-tax-v1";
export const taxAuthorizationNotice =
  "I authorize this synthetic demonstration to generate sample tax availability. No tax records will be requested or verified.";
export const enrichmentSubjectSchema = z.strictObject({
  subjectUserId: z.string().uuid().optional(),
});
export const syntheticIdentifierSchema = z
  .string()
  .regex(/^00000000[1-7]$/, "Use a registered synthetic identifier from 000000001 to 000000007.");
export const saveIdentifierSchema = enrichmentSubjectSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  value: syntheticIdentifierSchema,
});
export const authorizeTaxSchema = enrichmentSubjectSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  authorized: z.boolean(),
  noticeVersion: z.literal(taxAuthorizationNoticeVersion),
});
export const enrichmentKindSchema = z.enum(["business", "tax"]);
export const requestEnrichmentSchema = enrichmentSubjectSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  kind: enrichmentKindSchema,
});
export const retryEnrichmentSchema = z.strictObject({
  reason: z.enum(["provider_unavailable", "timeout", "operator_review"]),
});
export const enrichmentFactKeySchema = z.enum(["entity_type", "registration_state"]);
export const confirmEnrichmentFactSchema = enrichmentSubjectSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  runId: z.string().uuid(),
  key: enrichmentFactKeySchema,
});
export const enrichmentScenarioSchema = z.enum([
  "success",
  "not_found",
  "needs_review",
  "transient_error",
  "timeout",
  "terminal_error",
  "missing_input",
]);
export const enrichmentResultSchema = z.strictObject({
  provider: z.literal("keycade-enrichment-v1"),
  simulated: z.literal(true),
  kind: enrichmentKindSchema,
  operationId: z.string().uuid(),
  inputRevision: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
  outcome: z.enum(["complete", "not_found", "needs_review", "waiting_for_input"]),
  suggestions: z
    .array(z.strictObject({ key: enrichmentFactKeySchema, value: z.string().min(1).max(100) }))
    .max(2),
  taxRecords: z
    .array(
      z.strictObject({
        year: z.number().int().min(2000).max(2200),
        availability: z.literal("sample_available"),
      }),
    )
    .max(2),
});
export const enrichmentRunSchema = z.object({
  id: z.string().uuid(),
  kind: enrichmentKindSchema,
  simulated: z.literal(true),
  inputRevision: z.number().int().nonnegative(),
  status: z.enum([
    "waiting_for_input",
    "queued",
    "running",
    "succeeded",
    "retry_scheduled",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  stale: z.boolean(),
  attempts: z.number().int().nonnegative(),
  missingPrerequisites: z.array(z.enum(["business_name", "identifier", "tax_authorization"])),
  result: enrichmentResultSchema.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const enrichmentViewSchema = z.object({
  simulated: z.literal(true),
  subjectUserId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  identifier: z.object({
    present: z.boolean(),
    masked: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    kind: z.enum(["ein", "ssn"]),
  }),
  taxAuthorization: z.object({
    authorized: z.boolean(),
    noticeVersion: z.literal(taxAuthorizationNoticeVersion),
    notice: z.literal(taxAuthorizationNotice),
  }),
  runs: z.array(enrichmentRunSchema),
  confirmedFacts: z.array(
    z.object({
      key: enrichmentFactKeySchema,
      value: z.string(),
      runId: z.string().uuid(),
      confirmedAt: z.string().datetime(),
      stale: z.boolean(),
    }),
  ),
});
export type EnrichmentSubject = z.infer<typeof enrichmentSubjectSchema>;
export type EnrichmentKind = z.infer<typeof enrichmentKindSchema>;
export type EnrichmentScenario = z.infer<typeof enrichmentScenarioSchema>;
export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;
export type EnrichmentView = z.infer<typeof enrichmentViewSchema>;
