import { z } from "zod";
import { applicationSetupStepSchema } from "./applications.js";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";

export const staffPageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: applicationStatusSchema.optional(),
  productId: z.string().uuid().optional(),
  assigneeId: z.union([z.string().uuid(), z.literal("unassigned")]).optional(),
  sort: z
    .enum(["updated_desc", "created_desc", "created_asc", "business_asc"])
    .default("updated_desc"),
});
export const staffPersonSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string().email(),
});
export const staffOptionsSchema = z.object({
  products: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      version: z.number().int().positive(),
      active: z.boolean(),
    }),
  ),
  officers: z.array(staffPersonSchema.extend({ role: z.enum(["officer", "admin"]) })),
});
export const staffQueueItemSchema = z.object({
  id: z.string().uuid(),
  bankId: z.string().uuid(),
  businessId: z.string().uuid().nullable(),
  businessName: z.string().nullable(),
  productId: z.string().uuid().nullable(),
  productName: z.string().nullable(),
  requestedAmount: usdAmountSchema.nullable(),
  currency: z.literal("USD"),
  status: applicationStatusSchema,
  revision: z.number().int().positive(),
  source: z.enum(["borrower", "staff", "seed"]),
  assignedStaffId: z.string().uuid().nullable(),
  assignedStaffName: z.string().nullable(),
  contactEmail: z.string().email().nullable(),
  setupStatus: z.enum(["in_progress", "completed"]),
  currentStep: applicationSetupStepSchema,
  synthetic: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const staffApplicationPageSchema = z.object({
  items: z.array(staffQueueItemSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export const staffNoteSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  author: staffPersonSchema,
  updatedBy: staffPersonSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const staffWorkspaceSchema = staffQueueItemSchema.extend({
  purpose: z.string().nullable(),
  industryCode: z.string().nullable(),
  industryTaxonomyVersion: z.string().nullable(),
  createdBy: staffPersonSchema.nullable(),
  contact: z
    .object({
      email: z.string().email(),
      userId: z.string().uuid().nullable(),
      status: z.enum(["pending", "unverified", "verified"]),
    })
    .nullable(),
  setup: z.object({
    status: z.enum(["in_progress", "completed"]),
    currentStep: applicationSetupStepSchema,
    definitionVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
    completedSteps: z.array(applicationSetupStepSchema),
    skippedSteps: z.array(applicationSetupStepSchema),
    completedAt: z.string().datetime().nullable(),
  }),
  participants: z.array(
    staffPersonSchema.extend({
      role: z.enum(["applicant_admin", "owner", "adviser"]),
      scope: z.enum(["full", "assigned"]),
      status: z.enum(["active", "revoked"]),
      emailVerified: z.boolean(),
    }),
  ),
  notes: z.array(staffNoteSchema),
  tasks: z.null(),
  documents: z.null(),
  checks: z.null(),
});
export const assignStaffSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  assignedStaffId: z.string().uuid().nullable(),
});
export const addStaffNoteSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  body: z.string().trim().min(1).max(5000),
});
export const updateStaffNoteSchema = addStaffNoteSchema;
export const staffNoteParamsSchema = z.strictObject({
  bankId: z.string().uuid(),
  applicationId: z.string().uuid(),
  noteId: z.string().uuid(),
});

export type StaffPageQuery = z.infer<typeof staffPageQuerySchema>;
export type StaffOptions = z.infer<typeof staffOptionsSchema>;
export type StaffQueueItem = z.infer<typeof staffQueueItemSchema>;
export type StaffApplicationPage = z.infer<typeof staffApplicationPageSchema>;
export type StaffWorkspace = z.infer<typeof staffWorkspaceSchema>;
export type StaffNote = z.infer<typeof staffNoteSchema>;
export type AssignStaff = z.infer<typeof assignStaffSchema>;
export type AddStaffNote = z.infer<typeof addStaffNoteSchema>;
export type UpdateStaffNote = z.infer<typeof updateStaffNoteSchema>;
