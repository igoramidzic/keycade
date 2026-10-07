import { z } from "zod";

export const notificationPreferenceSchema = z.strictObject({ remindersEnabled: z.boolean() });
export const notificationKindSchema = z.enum([
  "access_requested",
  "application_started",
  "application_resume",
  "invitation",
  "task_assigned",
  "task_returned",
  "status_changed",
  "reminder",
  "signature_requested",
]);
export const notificationViewSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  status: z.enum(["pending", "queued", "sending", "delivered", "failed", "suppressed"]),
  attempts: z.number().int().nonnegative(),
  lastErrorCode: z.string().nullable(),
  suppressionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  canRetry: z.boolean(),
  simulated: z.literal(true),
});
export const notificationsViewSchema = z.object({
  notifications: z.array(notificationViewSchema),
  simulation: z.literal(true),
});
