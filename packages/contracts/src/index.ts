import { z } from "zod";

// Browser-safe wire contracts. Never import database or server configuration here.
export const applicationStatusSchema = z.enum([
  "draft",
  "collecting_information",
  "needs_information",
  "submitted",
  "in_review",
  "approved",
  "declined",
  "closing",
  "funded",
  "withdrawn",
]);
export const usdAmountSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})\.\d{2}$/);
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().uuid() }),
});
export const applicationParamsSchema = z.object({
  bankId: z.string().uuid(),
  applicationId: z.string().uuid(),
});
export const publicApplicationSchema = z.object({
  id: z.string().uuid(),
  bankId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  status: applicationStatusSchema,
  requestedAmount: usdAmountSchema.nullable(),
  currency: z.literal("USD"),
  purpose: z.string().nullable(),
  revision: z.number().int().positive(),
});
export const staffApplicationSchema = publicApplicationSchema.extend({
  assignedStaffId: z.string().uuid().nullable(),
  source: z.enum(["borrower", "staff", "seed"]),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const updatePurposeSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  purpose: z.string().trim().min(1).max(500),
});
// Cursor is a stable ID. New list services must choose allowlisted filters and sorts.
export const pageQuerySchema = z.strictObject({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const readinessSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  database: z.enum(["ready", "unavailable"]),
  worker: z.enum(["ready", "unavailable"]),
  simulation: z.literal(true),
});
export type PublicApplication = z.infer<typeof publicApplicationSchema>;
export type StaffApplication = z.infer<typeof staffApplicationSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
