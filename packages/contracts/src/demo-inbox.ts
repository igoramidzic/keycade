import { z } from "zod";
import { notificationKindSchema } from "./notifications.js";

export const demoInboxMessageParamsSchema = z.object({
  bankId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export const demoInboxMessageSummarySchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  kind: notificationKindSchema,
  applicationReference: z.string().nullable(),
  receivedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  state: z.enum(["available", "consumed", "expired", "unavailable"]),
});
export const demoInboxViewSchema = z.object({
  simulated: z.literal(true),
  messages: z.array(demoInboxMessageSummarySchema),
});
export const demoInboxMessageSchema = demoInboxMessageSummarySchema.extend({
  simulated: z.literal(true),
  text: z.string(),
  confirmUrl: z.string().url().nullable(),
});
export type DemoInboxView = z.infer<typeof demoInboxViewSchema>;
export type DemoInboxMessage = z.infer<typeof demoInboxMessageSchema>;
export type DemoInboxMessageSummary = z.infer<typeof demoInboxMessageSummarySchema>;
