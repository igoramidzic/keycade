import { z } from "zod";
import { readinessViewSchema } from "./checks.js";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";

export const reviewReasonLabels = {
  additional_information: "Additional information is required before a decision.",
  current_evidence_required: "Current supporting evidence is required before a decision.",
  demo_criteria_met: "The application meets the simulated review criteria.",
  demo_criteria_not_met: "The application does not meet the simulated review criteria.",
  unable_to_verify_information:
    "The supplied information could not be verified in this simulation.",
  applicant_requested: "The applicant requested withdrawal.",
  application_no_longer_needed: "The application is no longer needed.",
} as const;
export const reviewReasonSchema = z.enum(
  Object.keys(reviewReasonLabels) as [
    keyof typeof reviewReasonLabels,
    ...(keyof typeof reviewReasonLabels)[],
  ],
);
const command = {
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
};
const privateNote = z.string().trim().min(1).max(2000).optional();
export const submitApplicationSchema = z.strictObject(command);
export const startReviewSchema = z.strictObject(command);
export const requestInformationSchema = z.strictObject({
  ...command,
  reasonCode: z.enum(["additional_information", "current_evidence_required"]),
  privateNote,
  taskIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const approveApplicationSchema = z.strictObject({
  ...command,
  humanDecisionConfirmed: z.literal(true),
  reasonCode: z.literal("demo_criteria_met"),
  privateNote,
  approvedAmount: usdAmountSchema,
});
export const declineApplicationSchema = z.strictObject({
  ...command,
  humanDecisionConfirmed: z.literal(true),
  reasonCode: z.enum(["demo_criteria_not_met", "unable_to_verify_information"]),
  privateNote,
});
export const withdrawApplicationSchema = z.strictObject({
  ...command,
  reasonCode: z.enum(["applicant_requested", "application_no_longer_needed"]),
  privateNote,
});
export const submissionFactsSchema = z.object({
  businessName: z.string(),
  productName: z.string(),
  requestedAmount: usdAmountSchema,
  currency: z.literal("USD"),
  purpose: z.string().nullable(),
  industryCode: z.string().nullable(),
  industryTaxonomyVersion: z.string().nullable(),
});
export const reviewViewSchema = z.object({
  applicationId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: applicationStatusSchema,
  simulated: z.literal(true),
  canManage: z.boolean(),
  capabilities: z.object({
    submit: z.boolean(),
    startReview: z.boolean(),
    requestInformation: z.boolean(),
    approve: z.boolean(),
    decline: z.boolean(),
    withdraw: z.boolean(),
  }),
  readiness: readinessViewSchema,
  requestableTasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      stage: z.enum(["submission", "approval", "closing"]),
    }),
  ),
  submissions: z.array(
    z.object({
      id: z.string().uuid(),
      sequence: z.number().int().positive(),
      createdAt: z.string().datetime(),
      submittedByUserId: z.string().uuid().nullable(),
      submittedOnBehalf: z.boolean(),
      facts: submissionFactsSchema,
    }),
  ),
  decisions: z.array(
    z.object({
      id: z.string().uuid(),
      submissionId: z.string().uuid(),
      outcome: z.enum(["approved", "declined"]),
      approvedAmount: usdAmountSchema.nullable(),
      currency: z.literal("USD"),
      reasonCode: reviewReasonSchema,
      publicReason: z.string(),
      privateNote: z.string().nullable(),
      decidedByUserId: z.string().uuid().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.enum([
        "submit",
        "start_review",
        "request_information",
        "approve",
        "decline",
        "withdraw",
      ]),
      fromStatus: applicationStatusSchema,
      toStatus: applicationStatusSchema,
      revision: z.number().int().positive(),
      reasonCode: reviewReasonSchema.nullable(),
      publicReason: z.string().nullable(),
      privateNote: z.string().nullable(),
      actorUserId: z.string().uuid().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type ReviewView = z.infer<typeof reviewViewSchema>;
export type SubmissionFacts = z.infer<typeof submissionFactsSchema>;
export type ReviewReasonCode = z.infer<typeof reviewReasonSchema>;
