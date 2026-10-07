import { z } from "zod";
import {
  syntheticIdentifierSchema,
  taxAuthorizationNotice,
  taxAuthorizationNoticeVersion,
} from "./enrichment.js";

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
export const checkKindSchema = z.enum(["identity", "fraud"]);
export const checkOutcomeSchema = z.enum(["clear", "needs_review", "unable_to_verify"]);
export const checkResultSchema = z.strictObject({
  provider: z.literal("keycade-checks-v1"),
  simulated: z.literal(true),
  kind: checkKindSchema,
  operationId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  completedAt: z.string().datetime(),
  outcome: checkOutcomeSchema,
  findings: z
    .array(z.enum(["synthetic_match", "synthetic_review_flag", "synthetic_no_match"]))
    .min(1)
    .max(3),
});
export const checkPrerequisiteSchema = z.enum(["identifier", "owner_access", "reviewed_documents"]);
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
      canResolve: z.boolean(),
      runs: z.array(checkRunSchema),
    }),
  ),
});
export const retryCheckSchema = z.strictObject({
  runId: z.string().uuid(),
  reason: z.enum(["provider_unavailable", "timeout", "operator_review"]),
});
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
