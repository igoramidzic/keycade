import { describe, expect, it, vi } from "vitest";
import {
  type EnrichmentProviderRequest,
  identifierScenario,
  invokeEnrichmentProvider,
} from "./enrichment-provider.js";
import { systemClock } from "./provider.js";

const base: EnrichmentProviderRequest = {
  operationId: "10000000-0000-4000-8000-000000000001",
  bankId: "10000000-0000-4000-8000-000000000002",
  applicationId: "10000000-0000-4000-8000-000000000003",
  inputRevision: 2,
  idempotencyKey: "safe-operation",
  kind: "business",
  scenario: "success",
  attempt: 1,
};

describe("simulated business and tax providers", () => {
  it.each(["business", "tax"] as const)(
    "delays and returns typed %s evidence with no raw identifier",
    async (kind) => {
      vi.useFakeTimers();
      try {
        let settled = false;
        const promise = invokeEnrichmentProvider(
          { ...base, kind },
          { clock: systemClock, delayMs: 2500, deadlineMs: 60000 },
        ).then((result) => {
          settled = true;
          return result;
        });
        await vi.advanceTimersByTimeAsync(2499);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const result = await promise;
        expect(result).toMatchObject({
          provider: "keycade-enrichment-v1",
          simulated: true,
          kind,
          outcome: "complete",
          inputRevision: 2,
        });
        expect(kind === "business" ? result.suggestions : result.taxRecords).not.toHaveLength(0);
        expect(JSON.stringify(result)).not.toContain('"000000001"');
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it.each([
    ["not_found", "not_found"],
    ["needs_review", "needs_review"],
    ["missing_input", "waiting_for_input"],
  ] as const)("models %s", async (scenario, outcome) => {
    vi.useFakeTimers();
    try {
      const promise = invokeEnrichmentProvider(
        { ...base, scenario },
        { clock: systemClock, delayMs: 5, deadlineMs: 50 },
      );
      await vi.advanceTimersByTimeAsync(5);
      expect(await promise).toMatchObject({ outcome, simulated: true });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["timeout", "deadline_exceeded", true],
    ["transient_error", "transient_error", true],
    ["terminal_error", "terminal_error", false],
  ] as const)("classifies %s without exposing inputs", async (scenario, code, retryable) => {
    vi.useFakeTimers();
    try {
      const pending = invokeEnrichmentProvider(
        { ...base, scenario },
        { clock: systemClock, delayMs: 5, deadlineMs: 50 },
      );
      const assertion = expect(pending).rejects.toMatchObject({ code, retryable });
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("maps only registered invalid-for-real-world identifiers to deterministic scenarios", () => {
    expect(identifierScenario("000000004")).toBe("transient_error");
    expect(identifierScenario(null)).toBe("success");
    expect(() => identifierScenario("123456789")).toThrow("terminal_error");
  });
});
