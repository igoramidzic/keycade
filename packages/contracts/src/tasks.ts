import { z } from "zod";
import { secureTaskInputSchema } from "./checks.js";

export const taskStageSchema = z.enum(["submission", "approval", "closing"]);
export const taskStateSchema = z.enum([
  "open",
  "submitted",
  "needs_changes",
  "completed",
  "waived",
  "cancelled",
]);
export const taskVisibilitySchema = z.enum(["shared", "assigned", "private"]);
export const taskRevisionSchema = z.strictObject({ expectedRevision: z.number().int().positive() });
export const createManualTaskSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  stage: taskStageSchema.default("submission"),
  required: z.boolean().default(true),
  visibility: z.enum(["shared", "assigned"]).default("shared"),
  assigneeParticipantId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export const assignTaskSchema = taskRevisionSchema.extend({
  participantId: z.string().uuid().nullable(),
  dueAt: z.string().datetime().nullable().optional(),
});
export const saveTaskAnswerSchema = taskRevisionSchema.extend({
  answer: z.string().trim().min(1).max(4000),
});
export const reviewTaskSchema = taskRevisionSchema.extend({
  decision: z.enum(["completed", "needs_changes"]),
  reason: z.string().trim().min(1).max(2000),
});
export const waiveTaskSchema = taskRevisionSchema.extend({
  reason: z.string().trim().min(1).max(2000),
});
export const taskSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  stage: taskStageSchema,
  required: z.boolean(),
  state: taskStateSchema,
  source: z.enum(["rule", "manual"]),
  visibility: taskVisibilitySchema,
  reason: z.string(),
  stableKey: z.string(),
  occurrence: z.number().int().positive(),
  revision: z.number().int().positive(),
  evidenceRevision: z.number().int().nonnegative(),
  assigneeParticipantId: z.string().uuid().nullable(),
  assignedToYou: z.boolean().default(false),
  subjectUserId: z.string().uuid().nullable(),
  dueAt: z.string().datetime().nullable(),
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
  canReview: z.boolean(),
});
const counts = {
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  requiredCompleted: z.number().int().nonnegative(),
};
export const taskProgressSchema = z.object({
  ...counts,
  byStage: z.array(z.object({ stage: taskStageSchema, ...counts })),
});
export const taskViewSchema = taskSummarySchema.extend({
  inputKind: z.enum([
    "answer",
    "synthetic_business_identifier",
    "synthetic_personal_identifier",
    "tax_authorization",
    "signature",
  ]),
  signatureEnvelopeId: z.string().uuid().nullable().default(null),
  secureInput: secureTaskInputSchema.nullable(),
  answer: z.string().nullable(),
  answers: z.array(
    z.object({
      id: z.string().uuid(),
      answer: z.string(),
      evidenceRevision: z.number().int().positive(),
      createdAt: z.string().datetime(),
      authorUserId: z.string().uuid(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["completed", "needs_changes", "waived"]),
      reason: z.string(),
      evidenceRevision: z.number().int().nonnegative(),
      createdAt: z.string().datetime(),
    }),
  ),
  assignments: z.array(
    z.object({ participantId: z.string().uuid().nullable(), createdAt: z.string().datetime() }),
  ),
});
export const tasksViewSchema = z.object({
  applicationId: z.string().uuid(),
  simulation: z.literal(true),
  canManage: z.boolean(),
  tasks: z.array(taskViewSchema),
  progress: taskProgressSchema,
  assignees: z.array(
    z.object({ id: z.string().uuid(), userId: z.string().uuid(), displayName: z.string() }),
  ),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export type TaskView = z.infer<typeof taskViewSchema>;
export type TasksView = z.infer<typeof tasksViewSchema>;
export type TaskProgress = z.infer<typeof taskProgressSchema>;
export type TaskStage = z.infer<typeof taskStageSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
