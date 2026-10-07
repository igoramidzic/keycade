import { z } from "zod";

export const activityCursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);
export const activityReferenceSchema = z.uuid();
export const activityQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(100).optional(),
});
export const activityViewSchema = z.object({
  applicationId: z.uuid(),
  simulated: z.literal(true),
  entries: z.array(
    z.object({
      id: z.uuid(),
      createdAt: z.iso.datetime(),
      description: z.string(),
      actor: z.enum(["You", "Bank staff", "Participant", "System"]),
      reference: z.uuid().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type ActivityView = z.infer<typeof activityViewSchema>;
