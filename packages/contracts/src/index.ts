import { z } from "zod";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";

export * from "./applications.js";
// Browser-safe wire contracts. Never import database or server configuration here.
export { applicationStatusSchema, usdAmountSchema } from "./common.js";
export * from "./demo-inbox.js";
export * from "./document-processing.js";
export * from "./documents.js";
export * from "./enrichment.js";
export * from "./industry.js";
export * from "./intake.js";
export * from "./participants.js";
export * from "./setup-catalog.js";
export * from "./setup-identifier.js";
export * from "./signatures.js";
export * from "./staff.js";
export * from "./staff-overview.js";
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

export const authPortalSchema = z.enum(["borrower", "staff"]);
// Only destinations implemented by this release can be preserved across authentication.
export const authReturnPathSchema = z.union([
  z.literal("/"),
  z
    .string()
    .regex(
      /^\/(?:invitations|signatures|applications)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/setup)?$/,
    ),
]);
export const requestAccessLinkSchema = z.strictObject({
  email: z.string().trim().email().max(254),
  bankSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  portal: authPortalSchema,
  returnPath: authReturnPathSchema.default("/"),
});
export const requestAccessLinkResponseSchema = z.object({ message: z.string() });
export const consumeAccessLinkSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const consumeAccessLinkResponseSchema = z.object({ returnPath: authReturnPathSchema });
export const demoSignInSchema = requestAccessLinkSchema;
export const demoSignInResponseSchema = consumeAccessLinkResponseSchema;
export const sessionBankSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
});
export const authSessionSchema = z.discriminatedUnion("authenticated", [
  z.object({
    authenticated: z.literal(false),
    demoSignInEnabled: z.boolean(),
    demoInboxEnabled: z.boolean().default(false),
  }),
  z.object({
    authenticated: z.literal(true),
    demoSignInEnabled: z.boolean(),
    demoInboxEnabled: z.boolean().default(false),
    authenticationMethod: z.enum(["demo", "email_link"]),
    user: z.object({ email: z.string().email(), displayName: z.string().nullable() }),
    csrfToken: z.string().min(32),
    bank: sessionBankSchema,
    staff: z.boolean(),
  }),
]);
export const staffSessionSchema = z.object({
  bank: sessionBankSchema,
  role: z.enum(["officer", "admin"]),
});
export const logoutResponseSchema = z.object({ ok: z.literal(true) });
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthPortal = z.infer<typeof authPortalSchema>;
export * from "./activity.js";
export * from "./checks.js";
export * from "./closing.js";
export * from "./financial-facts.js";
export * from "./notifications.js";
export * from "./operations.js";
export * from "./review.js";
export * from "./tasks.js";
