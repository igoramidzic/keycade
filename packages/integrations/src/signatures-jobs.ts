import { randomUUID } from "node:crypto";
import {
  applications,
  auditEvents,
  type Database,
  signatureEnvelopes,
  signatureNotificationOutbox,
  signatureSendOutbox,
  signatureSigners,
} from "@keycade/db";
import {
  applyVerifiedSignatureEvent,
  signatureInputCurrent,
  signatureSignerEligible,
} from "@keycade/domain";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { type Clock, ProviderError, systemClock } from "./provider.js";
import { sendSyntheticSignatureEnvelope } from "./signatures-provider.js";

/** Durable fake-provider dispatch and expiration shared by Node workers and scheduled Workers. */
export async function processSignatureJobs(
  db: Database,
  options: {
    clock?: Clock;
    delayMs?: number;
    deadlineMs?: number;
    retryBaseMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const clock = options.clock ?? systemClock,
    deadlineMs = options.deadlineMs ?? 60000;
  const expired = await db
    .select()
    .from(signatureEnvelopes)
    .where(
      and(
        inArray(signatureEnvelopes.state, ["draft", "sent", "partially_signed"]),
        lte(signatureEnvelopes.expiresAt, clock.now()),
      ),
    )
    .limit(20);
  for (const envelope of expired)
    await applyVerifiedSignatureEvent(
      db,
      {
        eventId: randomUUID(),
        envelopeId: envelope.id,
        type: "expired",
        occurredAt: clock.now().toISOString(),
      },
      { now: clock.now() },
    );
  const claim = await db.transaction(async (tx) => {
    const [envelope] = await tx
      .select()
      .from(signatureEnvelopes)
      .where(
        and(
          eq(signatureEnvelopes.state, "draft"),
          inArray(signatureEnvelopes.deliveryStatus, ["pending", "running"]),
          lte(signatureEnvelopes.sendAvailableAt, clock.now()),
          or(
            isNull(signatureEnvelopes.sendLeaseUntil),
            lte(signatureEnvelopes.sendLeaseUntil, clock.now()),
          ),
        ),
      )
      .orderBy(signatureEnvelopes.sendAvailableAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!envelope) return null;
    const [intent] = await tx
      .select()
      .from(signatureSendOutbox)
      .where(
        and(
          eq(signatureSendOutbox.envelopeId, envelope.id),
          eq(signatureSendOutbox.generation, envelope.sendGeneration),
        ),
      );
    if (!intent) throw new Error("Signature send intent is missing.");
    if (envelope.sendAttempts >= 3) {
      await tx
        .update(signatureEnvelopes)
        .set({
          deliveryStatus: "failed",
          sendError: "retry_limit",
          sendClaimToken: null,
          sendLeaseUntil: null,
          updatedAt: clock.now(),
        })
        .where(eq(signatureEnvelopes.id, envelope.id));
      return { exhausted: true as const };
    }
    const token = randomUUID();
    await tx
      .update(signatureEnvelopes)
      .set({
        deliveryStatus: "running",
        sendAttempts: sql`${signatureEnvelopes.sendAttempts}+1`,
        sendClaimToken: token,
        sendLeaseUntil: new Date(clock.now().getTime() + deadlineMs + 30000),
        updatedAt: clock.now(),
      })
      .where(eq(signatureEnvelopes.id, envelope.id));
    await tx
      .update(signatureSendOutbox)
      .set({ dispatchedAt: clock.now() })
      .where(eq(signatureSendOutbox.id, intent.id));
    return {
      exhausted: false as const,
      envelope,
      token,
      requestId: intent.requestId,
      attempt: envelope.sendAttempts + 1,
    };
  });
  if (!claim) return expired.length > 0;
  if (claim.exhausted) return true;
  try {
    const result = await sendSyntheticSignatureEnvelope(
      {
        envelopeId: claim.envelope.id,
        bankId: claim.envelope.bankId,
        applicationId: claim.envelope.applicationId,
        generation: claim.envelope.sendGeneration,
        attempt: claim.attempt,
        requestId: claim.requestId,
        scenario: claim.envelope.scenario,
      },
      { clock, delayMs: options.delayMs ?? 2000, deadlineMs, signal: options.signal },
    );
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, claim.envelope.applicationId))
        .for("update");
      const [envelope] = await tx
        .select()
        .from(signatureEnvelopes)
        .where(
          and(
            eq(signatureEnvelopes.id, claim.envelope.id),
            eq(signatureEnvelopes.sendClaimToken, claim.token),
          ),
        )
        .for("update");
      if (!envelope || envelope.state !== "draft") return;
      let current = await signatureInputCurrent(tx, envelope);
      const signers = await tx
        .select()
        .from(signatureSigners)
        .where(eq(signatureSigners.envelopeId, envelope.id));
      for (const signer of signers)
        if (!(await signatureSignerEligible(tx, envelope, signer))) current = false;
      if (!current || clock.now() >= envelope.expiresAt) {
        await tx
          .update(signatureEnvelopes)
          .set({
            deliveryStatus: "failed",
            sendError: "stale_input",
            stale: true,
            sendClaimToken: null,
            sendLeaseUntil: null,
            updatedAt: clock.now(),
          })
          .where(eq(signatureEnvelopes.id, envelope.id));
        return;
      }
      await tx
        .update(signatureEnvelopes)
        .set({
          state: "sent",
          deliveryStatus: "sent",
          providerEnvelopeId: result.providerEnvelopeId,
          sendError: null,
          sendClaimToken: null,
          sendLeaseUntil: null,
          updatedAt: clock.now(),
        })
        .where(eq(signatureEnvelopes.id, envelope.id));
      for (const signer of signers)
        await tx
          .insert(signatureNotificationOutbox)
          .values({
            bankId: envelope.bankId,
            applicationId: envelope.applicationId,
            envelopeId: envelope.id,
            signerId: signer.id,
            recipientUserId: signer.userId,
            createdAt: clock.now(),
          })
          .onConflictDoNothing();
      await tx.insert(auditEvents).values({
        bankId: envelope.bankId,
        applicationId: envelope.applicationId,
        actorType: "system",
        action: "signature.sent",
        targetType: "signature_envelope",
        targetId: envelope.id,
        requestId: claim.requestId,
        metadata: { simulated: true },
        createdAt: clock.now(),
      });
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const retryable = error instanceof ProviderError && error.retryable && claim.attempt < 3;
    await db
      .update(signatureEnvelopes)
      .set({
        deliveryStatus: retryable ? "pending" : "failed",
        sendError: error instanceof ProviderError ? error.code : "invalid_provider_result",
        sendAvailableAt: new Date(
          clock.now().getTime() + (options.retryBaseMs ?? 1000) * 2 ** (claim.attempt - 1),
        ),
        sendClaimToken: null,
        sendLeaseUntil: null,
        updatedAt: clock.now(),
      })
      .where(
        and(
          eq(signatureEnvelopes.id, claim.envelope.id),
          eq(signatureEnvelopes.sendClaimToken, claim.token),
        ),
      );
  }
  return true;
}
