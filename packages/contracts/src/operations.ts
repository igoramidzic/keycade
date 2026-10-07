import { z } from "zod";

export const operationActionSchema = z.enum([
  "retry_scan",
  "retry_processing",
  "retry_check",
  "retry_signature",
  "void_signature",
  "retry_notification",
]);
export const operationCommandSchema = z.strictObject({
  action: operationActionSchema,
  resourceId: z.uuid(),
  runId: z.uuid().optional(),
});
export const operationsViewSchema = z.object({
  applicationId: z.uuid(),
  simulated: z.literal(true),
  worker: z.object({
    state: z.enum(["healthy", "offline", "unknown"]),
    lastSeenAt: z.iso.datetime().nullable(),
    staleAfterSeconds: z.number(),
  }),
  backlog: z.object({
    pending: z.number().int().nonnegative(),
    oldestAt: z.iso.datetime().nullable(),
    overdue: z.number().int().nonnegative(),
  }),
  items: z.array(
    z.object({
      id: z.string(),
      resourceId: z.uuid(),
      runId: z.uuid().nullable(),
      kind: z.enum(["document_scan", "document_processing", "check", "signature", "notification"]),
      title: z.string(),
      status: z.string(),
      stale: z.boolean(),
      attempts: z.number().int().nonnegative(),
      errorCode: z.string().nullable(),
      createdAt: z.iso.datetime(),
      actions: z.array(operationActionSchema),
    }),
  ),
});
export type OperationsView = z.infer<typeof operationsViewSchema>;
export type OperationCommand = z.infer<typeof operationCommandSchema>;
