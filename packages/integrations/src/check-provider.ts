import {
  businessAddressSchema,
  type CheckKind,
  type CheckResult,
  checkResultSchema,
  type EnrichmentScenario,
  type FootprintInput,
  type FootprintResult,
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
  footprintInput?: FootprintInput | null;
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
  if (request.kind === "loan_footprint") {
    if (!request.footprintInput) throw new Error("Missing address snapshot.");
    const footprint = evaluateFootprint(request.footprintInput);
    const outcome =
      footprint.reason === "inside_us_demo"
        ? "clear"
        : footprint.reason === "outside_us_demo"
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
      footprint,
      findings: [
        outcome === "clear"
          ? "synthetic_match"
          : outcome === "needs_review"
            ? "synthetic_review_flag"
            : "synthetic_no_match",
      ],
    });
  }
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

/** Deliberately tiny, bundled illustration registry. Every address field must match:
 * no geocoding, region/ZIP guessing or external address transmission occurs. */
const registeredLocations = [
  {
    address: {
      line1: "123 Synthetic Avenue",
      locality: "Portland",
      region: "ME",
      postalCode: "04101",
      countryCode: "US",
    },
    latitude: 43.6591,
    longitude: -70.2568,
    label: "Synthetic Portland fixture — illustrative location",
  },
  {
    address: {
      line1: "42 Synthetic Avenue",
      locality: "Teston",
      region: "NY",
      postalCode: "10001",
      countryCode: "US",
    },
    latitude: 40.7506,
    longitude: -73.9972,
    label: "Synthetic Teston fixture — illustrative location",
  },
] as const;
const addressKey = (address: NonNullable<FootprintInput["address"]>) =>
  JSON.stringify([
    address.line1,
    address.line2 ?? null,
    address.locality,
    address.region,
    address.postalCode,
    address.countryCode,
  ]);
export function evaluateFootprint(input: FootprintInput): FootprintResult {
  const parsed = businessAddressSchema.safeParse(input.address);
  const address = parsed.success ? parsed.data : null;
  const registered =
    address &&
    registeredLocations.find((location) => addressKey(location.address) === addressKey(address));
  return {
    ...input,
    address,
    countryCode: address?.countryCode ?? null,
    reason: !address
      ? "address_unavailable"
      : address.countryCode === "US"
        ? "inside_us_demo"
        : "outside_us_demo",
    coordinates: registered
      ? {
          latitude: registered.latitude,
          longitude: registered.longitude,
          label: registered.label,
          source: "registered_synthetic_fixture",
        }
      : null,
  };
}
