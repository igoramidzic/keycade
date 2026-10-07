import { describe, expect, it, vi } from "vitest";
import { type Clock, invokeDemoProvider, type ProviderRequest } from "./provider.js";

const request: ProviderRequest = {
  operationId: "70000000-0000-4000-8000-000000000001",
  bankId: "10000000-0000-4000-8000-000000000001",
  applicationId: "60000000-0000-4000-8000-000000000001",
  inputRevision: 1,
  idempotencyKey: "synthetic-demo",
  requestId: "synthetic-demo",
  scenario: "success",
  attempt: 1,
};
function controlledClock(): Clock & { advance(ms: number): Promise<void> } {
  let time = Date.parse("2026-01-01T00:00:00Z");
  const pending: Array<{
    at: number;
    resolve(): void;
    reject(error: Error): void;
    signal?: AbortSignal;
  }> = [];
  return {
    now: () => new Date(time),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("aborted"));
        const task = { at: time + ms, resolve, reject, signal };
        pending.push(task);
        signal?.addEventListener(
          "abort",
          () => {
            const i = pending.indexOf(task);
            if (i >= 0) pending.splice(i, 1);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
    advance: async (ms) => {
      time += ms;
      for (const task of [...pending])
        if (task.at <= time) {
          pending.splice(pending.indexOf(task), 1);
          task.resolve();
        }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}
describe("simulated provider and injected clock", () => {
  it("waits for configurable latency and returns typed simulation provenance", async () => {
    const clock = controlledClock();
    const settled = vi.fn();
    const pending = invokeDemoProvider(request, { clock, delayMs: 5000, deadlineMs: 60_000 }).then(
      (value) => {
        settled();
        return value;
      },
    );
    await clock.advance(4999);
    expect(settled).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(await pending).toMatchObject({
      simulated: true,
      provider: "keycade-demo-v1",
      outcome: "complete",
      inputRevision: 1,
      completedAt: "2026-01-01T00:00:05.000Z",
    });
  });
  it("enforces a deadline independently of simulated latency", async () => {
    const clock = controlledClock();
    const pending = invokeDemoProvider(
      { ...request, scenario: "timeout" },
      { clock, delayMs: 1, deadlineMs: 1000 },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: "deadline_exceeded",
      retryable: true,
    });
    await clock.advance(1000);
    await assertion;
  });
  it.each([
    ["missing_input", 1, "waiting_for_input"],
    ["transient_error", 2, "complete"],
  ] as const)("handles %s attempt %s", async (scenario, attempt, outcome) => {
    const clock = controlledClock();
    const pending = invokeDemoProvider(
      { ...request, scenario, attempt },
      { clock, delayMs: 10, deadlineMs: 1000 },
    );
    await clock.advance(10);
    expect(await pending).toMatchObject({ outcome, simulated: true });
  });
  it.each([
    ["transient_error", true],
    ["terminal_error", false],
  ] as const)("classifies %s retryability", async (scenario, retryable) => {
    const clock = controlledClock();
    const pending = invokeDemoProvider(
      { ...request, scenario },
      { clock, delayMs: 10, deadlineMs: 1000 },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: scenario, retryable });
    await clock.advance(10);
    await assertion;
  });
});
