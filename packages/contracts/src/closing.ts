import { z } from "zod";
import { readinessViewSchema } from "./checks.js";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";
import { signatureStateSchema } from "./signatures.js";

const command = {
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
};
export const startClosingSchema = z.strictObject(command);
export const recordFundingSchema = z.strictObject({
  ...command,
  humanFundingConfirmed: z.literal(true),
  fundedAmount: usdAmountSchema,
  fundedOn: z.string().date(),
  reference: z.string().trim().min(1).max(100),
});
export const approvedTermsSchema = z.object({
  decisionId: z.string().uuid(),
  submissionId: z.string().uuid(),
  businessId: z.string().uuid(),
  businessName: z.string(),
  productName: z.string(),
  requestedAmount: usdAmountSchema,
  approvedAmount: usdAmountSchema,
  currency: z.literal("USD"),
  approvedAt: z.string().datetime(),
});
export const fundedAccountSummarySchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  businessId: z.string().uuid(),
  businessName: z.string(),
  productName: z.string(),
  approvedAmount: usdAmountSchema,
  fundedAmount: usdAmountSchema,
  fundedOn: z.string().date(),
  reference: z.string(),
  currency: z.literal("USD"),
  simulated: z.literal(true),
  createdAt: z.string().datetime(),
});
export const closingViewSchema = z.object({
  applicationId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: applicationStatusSchema,
  simulated: z.literal(true),
  canManage: z.boolean(),
  capabilities: z.object({ startClosing: z.boolean(), recordFunding: z.boolean() }),
  approvedTerms: approvedTermsSchema.nullable(),
  package: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      policyVersion: z.number().int().positive(),
      amountPolicy: z.literal("exact_approved_amount"),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  conditions: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string(),
      title: z.string(),
      kind: z.enum(["task", "signature"]),
      required: z.boolean(),
      taskId: z.string().uuid(),
      passes: z.boolean(),
      signatureEnvelopeId: z.string().uuid().nullable(),
      signatureState: signatureStateSchema.nullable(),
    }),
  ),
  readiness: readinessViewSchema,
  account: fundedAccountSummarySchema.nullable(),
});
export const fundedAccountsViewSchema = z.object({
  simulated: z.literal(true),
  accounts: z.array(fundedAccountSummarySchema),
});
export type ClosingView = z.infer<typeof closingViewSchema>;
export type ApprovedTerms = z.infer<typeof approvedTermsSchema>;
export type FundedAccountSummary = z.infer<typeof fundedAccountSummarySchema>;
