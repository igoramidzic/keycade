import { z } from "zod";

export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new ProviderError("aborted", false));
      const abort = () => {
        clearTimeout(timer);
        reject(new ProviderError("aborted", false));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    }),
};
export const scenarioSchema = z.enum([
  "success",
  "missing_input",
  "transient_error",
  "timeout",
  "terminal_error",
]);
export type DemoScenario = z.infer<typeof scenarioSchema>;
export const demoResultSchema = z
  .object({
    provider: z.literal("keycade-demo-v1"),
    simulated: z.literal(true),
    outcome: z.enum(["complete", "waiting_for_input"]),
    operationId: z.uuid(),
    inputRevision: z.number().int().positive(),
    completedAt: z.iso.datetime(),
  })
  .strict();
export type DemoResult = z.infer<typeof demoResultSchema>;
export interface ProviderRequest {
  operationId: string;
  bankId: string;
  applicationId: string;
  inputRevision: number;
  idempotencyKey: string;
  requestId: string;
  scenario: DemoScenario;
  attempt: number;
}
export class ProviderError extends Error {
  constructor(
    public readonly code: "transient_error" | "terminal_error" | "deadline_exceeded" | "aborted",
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}
export interface ProviderOptions {
  clock: Clock;
  delayMs: number;
  deadlineMs: number;
  signal?: AbortSignal;
}

/** Harmless registered fixture operation. Does not verify finances or identity, or call a network provider. */
export async function invokeDemoProvider(
  request: ProviderRequest,
  options: ProviderOptions,
): Promise<DemoResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const call = async (): Promise<DemoResult> => {
    await options.clock.sleep(
      request.scenario === "timeout" ? options.deadlineMs + 1 : options.delayMs,
      controller.signal,
    );
    if (request.scenario === "terminal_error") throw new ProviderError("terminal_error", false);
    if (request.scenario === "transient_error" && request.attempt === 1)
      throw new ProviderError("transient_error", true);
    return demoResultSchema.parse({
      provider: "keycade-demo-v1",
      simulated: true,
      outcome: request.scenario === "missing_input" ? "waiting_for_input" : "complete",
      operationId: request.operationId,
      inputRevision: request.inputRevision,
      completedAt: options.clock.now().toISOString(),
    });
  };
  const deadline = options.clock.sleep(options.deadlineMs, controller.signal).then(() => {
    throw new ProviderError("deadline_exceeded", true);
  });
  try {
    return await Promise.race([call(), deadline]);
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", abort);
  }
}
