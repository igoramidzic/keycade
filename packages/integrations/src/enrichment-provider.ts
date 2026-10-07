import {
  type EnrichmentKind,
  type EnrichmentResult,
  type EnrichmentScenario,
  enrichmentResultSchema,
} from "@keycade/contracts";
import { type Clock, ProviderError } from "./provider.js";

export type EnrichmentProviderRequest = {
  operationId: string;
  bankId: string;
  applicationId: string;
  inputRevision: number;
  idempotencyKey: string;
  kind: EnrichmentKind;
  scenario: EnrichmentScenario;
  attempt: number;
};

/** Only invalid-for-real-world, registered synthetic identifiers select demo scenarios. */
export function identifierScenario(value: string | null): EnrichmentScenario {
  const scenarios: Record<string, EnrichmentScenario> = {
    "000000001": "success",
    "000000002": "not_found",
    "000000003": "needs_review",
    "000000004": "transient_error",
    "000000005": "timeout",
    "000000006": "terminal_error",
    "000000007": "missing_input",
  };
  if (value === null) return "success";
  const scenario = scenarios[value];
  if (!scenario) throw new ProviderError("terminal_error", false);
  return scenario;
}

export async function invokeEnrichmentProvider(
  request: EnrichmentProviderRequest,
  options: { clock: Clock; delayMs: number; deadlineMs: number; signal?: AbortSignal },
): Promise<EnrichmentResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const call = async () => {
    await options.clock.sleep(
      request.scenario === "timeout" ? options.deadlineMs + 1 : options.delayMs,
      controller.signal,
    );
    if (request.scenario === "terminal_error") throw new ProviderError("terminal_error", false);
    if (request.scenario === "transient_error" && request.attempt === 1)
      throw new ProviderError("transient_error", true);
    const outcome =
      request.scenario === "not_found"
        ? "not_found"
        : request.scenario === "needs_review"
          ? "needs_review"
          : request.scenario === "missing_input"
            ? "waiting_for_input"
            : "complete";
    const hasEvidence = outcome === "complete" || outcome === "needs_review";
    return enrichmentResultSchema.parse({
      provider: "keycade-enrichment-v1",
      simulated: true,
      kind: request.kind,
      operationId: request.operationId,
      inputRevision: request.inputRevision,
      completedAt: options.clock.now().toISOString(),
      outcome,
      suggestions:
        request.kind === "business" && hasEvidence
          ? [
              { key: "entity_type", value: "Synthetic limited liability company" },
              { key: "registration_state", value: "DE (simulated)" },
            ]
          : [],
      taxRecords:
        request.kind === "tax" && hasEvidence
          ? [{ year: options.clock.now().getUTCFullYear() - 1, availability: "sample_available" }]
          : [],
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
