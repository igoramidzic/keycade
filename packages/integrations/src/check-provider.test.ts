import { describe, expect, it, vi } from "vitest";
import { type CheckProviderRequest, invokeCheckProvider } from "./check-provider.js";
import { systemClock } from "./provider.js";

const base: CheckProviderRequest = {
  operationId: "10000000-0000-4000-8000-000000000001",
  bankId: "10000000-0000-4000-8000-000000000002",
  applicationId: "10000000-0000-4000-8000-000000000003",
  fingerprint: "a".repeat(64),
  idempotencyKey: "safe-operation",
  kind: "identity",
  scenario: "success",
  attempt: 1,
};
describe("delayed simulated identity/fraud provider", () => {
  it.each(["identity", "fraud"] as const)("delays typed %s clear evidence", async (kind) => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = invokeCheckProvider(
        { ...base, kind },
        { clock: systemClock, delayMs: 5000, deadlineMs: 60000 },
      ).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({
        provider: "keycade-checks-v1",
        simulated: true,
        kind,
        outcome: "clear",
        findings: ["synthetic_match"],
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["needs_review", "needs_review"],
    ["not_found", "unable_to_verify"],
    ["missing_input", "unable_to_verify"],
  ] as const)("keeps %s non-clear", async (scenario, outcome) => {
    vi.useFakeTimers();
    try {
      const pending = invokeCheckProvider(
        { ...base, scenario },
        { clock: systemClock, delayMs: 5, deadlineMs: 50 },
      );
      await vi.advanceTimersByTimeAsync(5);
      expect(await pending).toMatchObject({ outcome, simulated: true });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["timeout", "deadline_exceeded", true],
    ["transient_error", "transient_error", true],
    ["terminal_error", "terminal_error", false],
  ] as const)("classifies %s", async (scenario, code, retryable) => {
    vi.useFakeTimers();
    try {
      const pending = expect(
        invokeCheckProvider(
          { ...base, scenario },
          { clock: systemClock, delayMs: 5, deadlineMs: 50 },
        ),
      ).rejects.toMatchObject({ code, retryable });
      await vi.advanceTimersByTimeAsync(50);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
