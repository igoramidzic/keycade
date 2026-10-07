import { z } from "zod";

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
