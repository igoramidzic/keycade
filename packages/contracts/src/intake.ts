import { z } from "zod";
import { usdAmountSchema } from "./common.js";

export const publicIntakeParamsSchema = z.strictObject({
  bankSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
});
export const publicIntakeQuerySchema = z.strictObject({});
export const intakeProductSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  minimumAmount: usdAmountSchema,
  maximumAmount: usdAmountSchema,
  currency: z.literal("USD"),
});
export const publicIntakeSchema = z.object({
  bank: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    synthetic: z.boolean(),
  }),
  products: z.array(intakeProductSchema),
});
export type PublicIntake = z.infer<typeof publicIntakeSchema>;
