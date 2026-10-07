import { z } from "zod";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";
import { isValidIndustry } from "./industry.js";
import { intakeProductSchema } from "./intake.js";
import { taskProgressSchema } from "./tasks.js";

export const applicationSetupStepSchema = z.enum([
  "business_name",
  "product",
  "amount",
  "purpose",
  "industry",
  "review",
]);

export const bankParamsSchema = z.strictObject({ bankId: z.string().uuid() });
export const publicStartApplicationSchema = z.strictObject({
  email: z.string().trim().email().max(254),
  bankSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  productSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
});
export const createDraftSchema = z.strictObject({
  email: z.string().trim().email().max(254).optional(),
  productId: z.string().uuid().optional(),
  businessId: z.string().uuid().optional(),
  answers: z
    .strictObject({
      businessName: z.string().trim().min(1).max(200).optional(),
      requestedAmount: usdAmountSchema.optional(),
      purpose: z.string().trim().min(1).max(500).optional(),
    })
    .optional(),
  idempotencyKey: z.string().uuid(),
});
export const saveApplicationSetupSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  answers: z
    .strictObject({
      businessName: z.string().trim().min(1).max(200).optional(),
      productId: z.string().uuid().optional(),
      requestedAmount: usdAmountSchema.optional(),
      purpose: z.string().trim().min(1).max(500).optional(),
      industryCode: z
        .string()
        .regex(/^\d{2,6}$/)
        .nullable()
        .optional(),
      industryTaxonomyVersion: z.string().trim().min(1).max(40).nullable().optional(),
    })
    .superRefine((answers, context) => {
      const code = answers.industryCode;
      const version = answers.industryTaxonomyVersion;
      if (code === undefined && version === undefined) return;
      if (code === null && version === null) return;
      if (
        typeof code !== "string" ||
        typeof version !== "string" ||
        !isValidIndustry(code, version)
      )
        context.addIssue({
          code: "custom",
          path: ["industryCode"],
          message: "Select a valid industry from the 2022 U.S. NAICS catalog, or skip industry.",
        });
    }),
  step: applicationSetupStepSchema.exclude(["review"]).optional(),
  skip: z.boolean().optional(),
  currentStep: applicationSetupStepSchema,
});
export const finishApplicationSetupSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});
export const claimApplicationSchema = z.strictObject({});

export const applicationSelectionSchema = z.object({
  id: z.string().uuid(),
  bankId: z.string().uuid(),
  businessId: z.string().uuid().nullable(),
  businessName: z.string().nullable(),
  productName: z.string().nullable(),
  updatedAt: z.string().datetime(),
  accessScope: z.enum(["full", "assigned"]),
  productId: z.string().uuid().nullable(),
  requestedAmount: usdAmountSchema.nullable(),
  status: applicationStatusSchema,
  revision: z.number().int().positive(),
  synthetic: z.boolean(),
  setupStatus: z.enum(["in_progress", "completed"]),
  nextDestination: z.enum(["setup", "portal", "closed", "assigned"]),
  currentStep: applicationSetupStepSchema,
  claimRequired: z.boolean(),
  taskProgress: taskProgressSchema.nullable().default(null),
});
export const applicationSetupSchema = applicationSelectionSchema.extend({
  selectedProduct: intakeProductSchema.extend({ active: z.boolean() }).nullable(),
  purpose: z.string().nullable(),
  industryCode: z.string().nullable(),
  industryTaxonomyVersion: z.string().nullable(),
  definitionVersion: z.number().int().positive(),
  completedSteps: z.array(applicationSetupStepSchema),
  skippedSteps: z.array(applicationSetupStepSchema),
  completedAt: z.string().datetime().nullable(),
});
export const applicationPortalSchema = applicationSelectionSchema.extend({
  purpose: z.string().nullable(),
  remainingTasks: z.number().int().nonnegative(),
  canReview: z.boolean().default(false),
});
export const applicationPageSchema = z.object({
  items: z.array(applicationSelectionSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type ApplicationSetupStep = z.infer<typeof applicationSetupStepSchema>;
export type PublicStartApplication = z.infer<typeof publicStartApplicationSchema>;
export type CreateDraft = z.infer<typeof createDraftSchema>;
export type SaveApplicationSetup = z.infer<typeof saveApplicationSetupSchema>;
export type FinishApplicationSetup = z.infer<typeof finishApplicationSetupSchema>;
export type ApplicationSelection = z.infer<typeof applicationSelectionSchema>;
export type ApplicationSetup = z.infer<typeof applicationSetupSchema>;
export type ApplicationPage = z.infer<typeof applicationPageSchema>;

export type ApplicationPortal = z.infer<typeof applicationPortalSchema>;
