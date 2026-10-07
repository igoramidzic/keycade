import { z } from "zod";

export const signatureStateSchema = z.enum([
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "voided",
]);
export const signatureScenarioSchema = z.enum(["success", "transient_error", "terminal_error"]);
export const createSignatureEnvelopeSchema = z.strictObject({
  taskId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  signerParticipantIds: z
    .array(z.string().uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, "Each signer must be unique."),
  idempotencyKey: z.string().uuid(),
  scenario: signatureScenarioSchema.default("success"),
  expiresAt: z.string().datetime().optional(),
});
export const signatureActionSchema = z.strictObject({ action: z.enum(["sign", "decline"]) });
export const signatureEnvelopeParamsSchema = z.object({
  bankId: z.string().uuid(),
  applicationId: z.string().uuid(),
  envelopeId: z.string().uuid(),
});
export const signatureEventSchema = z
  .strictObject({
    eventId: z.string().uuid(),
    envelopeId: z.string().uuid(),
    type: z.enum(["signer_signed", "signer_declined", "expired", "voided"]),
    signerId: z.string().uuid().optional(),
    occurredAt: z.string().datetime(),
  })
  .superRefine((event, context) => {
    if (event.type.startsWith("signer_") && !event.signerId)
      context.addIssue({ code: "custom", path: ["signerId"], message: "A signer is required." });
  });
export const signatureSignerSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string().email(),
  state: z.enum(["pending", "signed", "declined"]),
  actedAt: z.string().datetime().nullable(),
});
export const signatureEnvelopeSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  taskTitle: z.string(),
  sourceVersionId: z.string().uuid(),
  sourceFileName: z.string(),
  state: signatureStateSchema,
  deliveryStatus: z.enum(["not_sent", "pending", "running", "sent", "failed"]),
  sendError: z.string().nullable(),
  sendAttempts: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  stale: z.boolean(),
  simulated: z.literal(true),
  signers: z.array(signatureSignerSchema),
  canSign: z.boolean(),
  canDecline: z.boolean(),
  canSend: z.boolean(),
  canVoid: z.boolean(),
  canDownloadArtifact: z.boolean(),
});
export const signaturesViewSchema = z.object({
  simulated: z.literal(true),
  canCreate: z.boolean(),
  envelopes: z.array(signatureEnvelopeSchema),
});
export const signatureLookupSchema = z.object({
  applicationId: z.string().uuid(),
  signatures: signaturesViewSchema,
});
export const signatureActionResultSchema = z.object({ ok: z.literal(true) });
export type SignatureEvent = z.infer<typeof signatureEventSchema>;
export type SignaturesView = z.infer<typeof signaturesViewSchema>;
export type SignatureEnvelope = z.infer<typeof signatureEnvelopeSchema>;
