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

describe("simulated Loan Footprint country rule and registered map locations", () => {
  const address = {
    line1: "123 Synthetic Avenue",
    locality: "Portland",
    region: "ME",
    postalCode: "04101",
    countryCode: "US",
  };
  async function evaluate(value: typeof address | null) {
    vi.useFakeTimers();
    try {
      const promise = invokeCheckProvider(
        {
          ...base,
          kind: "loan_footprint",
          footprintInput: { addressRevision: 7, address: value, policyVersion: "US-only-demo-v1" },
        },
        { clock: systemClock, delayMs: 50, deadlineMs: 500 },
      );
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      return await promise;
    } finally {
      vi.useRealTimers();
    }
  }
  it("binds a delayed clear result and illustrative registered coordinates to the exact address revision", async () => {
    expect(await evaluate(address)).toMatchObject({
      outcome: "clear",
      simulated: true,
      footprint: {
        address,
        addressRevision: 7,
        countryCode: "US",
        policyVersion: "US-only-demo-v1",
        reason: "inside_us_demo",
        coordinates: {
          latitude: 43.6591,
          longitude: -70.2568,
          source: "registered_synthetic_fixture",
        },
      },
    });
  });
  it.each([
    { line1: "999 Unknown Synthetic Avenue" },
    { locality: "Other city" },
    { region: "AK" },
    { postalCode: "99999" },
    { line2: "Suite 3" },
  ])("does not invent coordinates for a changed address component: %o", async (change) => {
    expect(await evaluate({ ...address, ...change })).toMatchObject({
      outcome: "clear",
      footprint: { coordinates: null, reason: "inside_us_demo" },
    });
  });
  it("never treats a non-US country as clear, even with a US ZIP", async () => {
    expect(await evaluate({ ...address, countryCode: "CA" })).toMatchObject({
      outcome: "needs_review",
      footprint: { countryCode: "CA", reason: "outside_us_demo", coordinates: null },
    });
  });
  it.each([
    null,
    { ...address, countryCode: "" },
    { ...address, countryCode: "USA" },
    { ...address, locality: " " },
    { ...address, line1: "" },
  ])("keeps missing and invalid input unable to verify: %o", async (value) => {
    expect(await evaluate(value)).toMatchObject({
      outcome: "unable_to_verify",
      footprint: {
        address: null,
        countryCode: null,
        reason: "address_unavailable",
        coordinates: null,
      },
    });
  });
});
