import { z } from "zod";
import {
  syntheticIdentifierSchema,
  taxAuthorizationNotice,
  taxAuthorizationNoticeVersion,
} from "./enrichment.js";
import { businessAddressSchema } from "./setup-catalog.js";

const taskStageSchema = z.enum(["submission", "approval", "closing"]);

export const secureTaskInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  identifierPresent: z.boolean(),
  identifierMasked: z.string().nullable(),
  taxAuthorized: z.boolean(),
  noticeVersion: z.literal(taxAuthorizationNoticeVersion),
  notice: z.literal(taxAuthorizationNotice),
  canEdit: z.boolean(),
});
export const captureTaskIdentifierSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedInputRevision: z.number().int().nonnegative(),
  value: syntheticIdentifierSchema,
});
export const authorizeTaskTaxSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedInputRevision: z.number().int().nonnegative(),
  authorized: z.boolean(),
  noticeVersion: z.literal(taxAuthorizationNoticeVersion),
});
export const loanFootprintPolicyVersion = "US-only-demo-v1" as const;
export const footprintInputSchema = z.strictObject({
  addressRevision: z.number().int().nonnegative(),
  address: businessAddressSchema.nullable(),
  policyVersion: z.literal(loanFootprintPolicyVersion),
});
export const footprintResultSchema = footprintInputSchema.extend({
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  reason: z.enum(["inside_us_demo", "outside_us_demo", "address_unavailable"]),
  coordinates: z
    .strictObject({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      label: z.string().min(1).max(160),
      source: z.literal("registered_synthetic_fixture"),
    })
    .nullable(),
});
export type FootprintInput = z.infer<typeof footprintInputSchema>;
export type FootprintResult = z.infer<typeof footprintResultSchema>;
export const checkKindSchema = z.enum(["identity", "fraud", "loan_footprint"]);
export const checkOutcomeSchema = z.enum(["clear", "needs_review", "unable_to_verify"]);
export const checkResultSchema = z
  .strictObject({
    provider: z.literal("keycade-checks-v1"),
    simulated: z.literal(true),
    kind: checkKindSchema,
    operationId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: z.string().datetime(),
    outcome: checkOutcomeSchema,
    footprint: footprintResultSchema.optional(),
    findings: z
      .array(z.enum(["synthetic_match", "synthetic_review_flag", "synthetic_no_match"]))
      .min(1)
      .max(3),
  })
  .superRefine((result, context) => {
    if ((result.kind === "loan_footprint") !== Boolean(result.footprint))
      context.addIssue({
        code: "custom",
        message: "Footprint evidence is required only for geographic checks.",
      });
    if (result.footprint) {
      const footprint = result.footprint;
      const outcome = !footprint.address
        ? "unable_to_verify"
        : footprint.address.countryCode === "US"
          ? "clear"
          : "needs_review";
      const reason = !footprint.address
        ? "address_unavailable"
        : footprint.address.countryCode === "US"
          ? "inside_us_demo"
          : "outside_us_demo";
      if (
        result.outcome !== outcome ||
        footprint.reason !== reason ||
        footprint.countryCode !== (footprint.address?.countryCode ?? null) ||
        (footprint.coordinates && footprint.countryCode !== "US")
      )
        context.addIssue({
          code: "custom",
          message: "Footprint evidence must agree with the explicit address country.",
        });
    }
  });
export const checkPrerequisiteSchema = z.enum([
  "identifier",
  "owner_access",
  "reviewed_documents",
  "business_address",
]);
export const checkRunSchema = z.object({
  id: z.string().uuid(),
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
  missingPrerequisites: z.array(checkPrerequisiteSchema),
  outcome: checkOutcomeSchema.nullable(),
  evidence: checkResultSchema.nullable(),
  footprintInput: footprintInputSchema.nullable().default(null),
  errorCode: z.string().nullable(),
  resolved: z.boolean(),
  resolution: z
    .object({
      reason: z.literal("reviewed_synthetic_evidence"),
      resolvedByUserId: z.string().uuid(),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const checksViewSchema = z.object({
  applicationId: z.string().uuid(),
  simulated: z.literal(true),
  canManage: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string().uuid(),
      kind: checkKindSchema,
      title: z.string(),
      stage: taskStageSchema,
      required: z.boolean(),
      subjectUserId: z.string().uuid().nullable(),
      subjectRelationshipId: z.string().uuid().nullable(),
      currentRunId: z.string().uuid().nullable(),
      passes: z.boolean(),
      canRetry: z.boolean(),
      canRefresh: z.boolean().default(false),
      canResolve: z.boolean(),
      runs: z.array(checkRunSchema),
    }),
  ),
});
export const retryCheckSchema = z.strictObject({
  runId: z.string().uuid(),
  reason: z.enum(["provider_unavailable", "timeout", "operator_review"]),
});
export const refreshFootprintSchema = z.strictObject({
  runId: z.string().uuid(),
  expectedAddressRevision: z.number().int().nonnegative(),
});
export const refreshCheckSchema = refreshFootprintSchema;
export const resolveCheckSchema = z.strictObject({
  runId: z.string().uuid(),
  reason: z.literal("reviewed_synthetic_evidence"),
});
export const readinessBlockerSchema = z.object({
  kind: z.enum(["setup", "application", "task", "check", "lifecycle"]),
  id: z.string().nullable(),
  stage: taskStageSchema,
  reason: z.string(),
  title: z.string(),
});
export const readinessViewSchema = z.object({
  applicationId: z.string().uuid(),
  simulated: z.literal(true),
  scope: z.enum(["application", "assigned"]),
  gates: z.array(
    z.object({
      stage: taskStageSchema,
      ready: z.boolean(),
      blockers: z.array(readinessBlockerSchema),
    }),
  ),
});
export type CheckResult = z.infer<typeof checkResultSchema>;
export type CheckKind = z.infer<typeof checkKindSchema>;
export type ChecksView = z.infer<typeof checksViewSchema>;
export type ReadinessView = z.infer<typeof readinessViewSchema>;
export type ReadinessBlocker = z.infer<typeof readinessBlockerSchema>;
