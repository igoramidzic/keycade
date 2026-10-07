import {
  type CheckKind,
  type CheckResult,
  checkResultSchema,
  type EnrichmentScenario,
} from "@keycade/contracts";
import { invokeEnrichmentProvider } from "./enrichment-provider.js";
import type { Clock } from "./provider.js";
export type CheckProviderRequest = {
  operationId: string;
  bankId: string;
  applicationId: string;
  fingerprint: string;
  idempotencyKey: string;
  kind: CheckKind;
  scenario: EnrichmentScenario;
  attempt: number;
};
/** Shares the deterministic synthetic transport/deadline simulator; maps to a separate strict
 * identity/fraud contract. Provider findings never constitute an application decision. */
export async function invokeCheckProvider(
  request: CheckProviderRequest,
  options: { clock: Clock; delayMs: number; deadlineMs: number; signal?: AbortSignal },
): Promise<CheckResult> {
  const transport = await invokeEnrichmentProvider(
    { ...request, kind: "business", inputRevision: 0 },
    options,
  );
  const outcome =
    transport.outcome === "complete"
      ? "clear"
      : transport.outcome === "needs_review"
        ? "needs_review"
        : "unable_to_verify";
  return checkResultSchema.parse({
    provider: "keycade-checks-v1",
    simulated: true,
    kind: request.kind,
    operationId: request.operationId,
    fingerprint: request.fingerprint,
    completedAt: transport.completedAt,
    outcome,
    findings: [
      outcome === "clear"
        ? "synthetic_match"
        : outcome === "needs_review"
          ? "synthetic_review_flag"
          : "synthetic_no_match",
    ],
  });
}
