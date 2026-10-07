import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "./provider.js";
import {
  createSignatureWebhookAuthenticator,
  sendSyntheticSignatureEnvelope,
} from "./signatures-provider.js";

afterEach(() => vi.useRealTimers());
describe("simulated signature provider boundary", () => {
  it("authenticates the exact raw payload with a purpose-separated secret", () => {
    const one = createSignatureWebhookAuthenticator("a".repeat(64)),
      two = createSignatureWebhookAuthenticator("b".repeat(64));
    const body = JSON.stringify({ eventId: randomUUID(), simulated: true }),
      signature = one.sign(body);
    expect(one.verify(body, signature)).toBe(true);
    for (const invalid of [
      undefined,
      "",
      signature.slice(0, -1),
      "v1=" + "x".repeat(64),
      two.sign(body),
    ])
      expect(one.verify(body, invalid)).toBe(false);
    expect(one.verify(body + " ", signature)).toBe(false);
  });
  it("delays a deterministic send and does not create a signature as a side effect", async () => {
    vi.useFakeTimers();
    const envelopeId = randomUUID();
    const call = sendSyntheticSignatureEnvelope(
      {
        envelopeId,
        bankId: randomUUID(),
        applicationId: randomUUID(),
        generation: 1,
        attempt: 1,
        requestId: randomUUID(),
        scenario: "success",
      },
      { clock: systemClock, delayMs: 2000, deadlineMs: 10000 },
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await call).toMatchObject({
      simulated: true,
      envelopeId,
      status: "sent",
      providerEnvelopeId: `synthetic-${envelopeId}`,
    });
  });
  it("enforces a bounded deadline without consuming unhandled rejection timers", async () => {
    vi.useFakeTimers();
    const call = sendSyntheticSignatureEnvelope(
      {
        envelopeId: randomUUID(),
        bankId: randomUUID(),
        applicationId: randomUUID(),
        generation: 1,
        attempt: 1,
        requestId: randomUUID(),
        scenario: "success",
      },
      { clock: systemClock, delayMs: 2000, deadlineMs: 100 },
    );
    const expectation = expect(call).rejects.toMatchObject({
      code: "deadline_exceeded",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });
});
