import { createHmac, timingSafeEqual } from "node:crypto";
import { invokeDemoProvider, type ProviderOptions } from "./provider.js";

/** A separate-purpose HMAC key; the encryption key is never used directly as a webhook MAC key. */
export function createSignatureWebhookAuthenticator(encryptionKey: string) {
  if (!/^[a-f0-9]{64}$/.test(encryptionKey))
    throw new Error("Signature webhook verification is not configured.");
  const key = createHmac("sha256", Buffer.from(encryptionKey, "hex"))
    .update("keycade-signature-webhook-v1")
    .digest();
  const sign = (body: string) => `v1=${createHmac("sha256", key).update(body).digest("hex")}`;
  return {
    sign,
    verify(body: string, signature: string | undefined) {
      if (!signature || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
      return timingSafeEqual(Buffer.from(sign(body)), Buffer.from(signature));
    },
  };
}
export async function sendSyntheticSignatureEnvelope(
  request: {
    envelopeId: string;
    bankId: string;
    applicationId: string;
    generation: number;
    attempt: number;
    requestId: string;
    scenario: "success" | "transient_error" | "terminal_error";
  },
  options: ProviderOptions,
) {
  await invokeDemoProvider(
    {
      operationId: request.envelopeId,
      bankId: request.bankId,
      applicationId: request.applicationId,
      inputRevision: request.generation,
      idempotencyKey: `${request.envelopeId}:${request.generation}`,
      requestId: request.requestId,
      scenario: request.scenario,
      attempt: request.attempt,
    },
    options,
  );
  return {
    provider: "keycade-signatures-v1" as const,
    simulated: true as const,
    envelopeId: request.envelopeId,
    providerEnvelopeId: `synthetic-${request.envelopeId}`,
    status: "sent" as const,
  };
}
