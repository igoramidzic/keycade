import type { BusinessAddress, ChecksView } from "@keycade/contracts";

export type LoanFootprintCheck = ChecksView["checks"][number];

export function footprintAddress(address: BusinessAddress | null | undefined) {
  if (!address) return "Not provided";
  return [
    address.line1,
    address.line2,
    address.locality,
    address.region,
    address.postalCode,
    address.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}

function addressKey(address: BusinessAddress | null | undefined) {
  return address
    ? JSON.stringify([
        address.line1,
        address.line2 ?? "",
        address.locality,
        address.region,
        address.postalCode,
        address.countryCode,
      ])
    : "null";
}

export function loanFootprintDisplay(
  check: LoanFootprintCheck,
  savedAddress: BusinessAddress | null,
  unavailable = false,
) {
  const run = check.runs.find((entry) => entry.id === check.currentRunId);
  const input = run?.footprintInput;
  const result = run?.evidence?.footprint;
  const stale = Boolean(
    run?.stale || (input && addressKey(input.address) !== addressKey(savedAddress)),
  );
  const base = { run, input, result, stale, clear: false, coordinates: null };
  if (unavailable)
    return { ...base, label: "Status unavailable", detail: "Refresh to load the current result." };
  if (stale)
    return {
      ...base,
      label: "Stale result",
      detail: "The saved address changed. A current result is needed; the previous pin is hidden.",
    };
  if (!run || run.status === "waiting_for_input")
    return {
      ...base,
      label: "Needs address",
      detail: "Save a complete business address, including its country, to run this check.",
    };
  if (["queued", "running", "retry_scheduled"].includes(run.status))
    return {
      ...base,
      label:
        run.status === "running"
          ? "Running"
          : run.status === "retry_scheduled"
            ? "Retry scheduled"
            : "Queued",
      detail: "The country check is in progress. No current geographic result is available.",
    };
  if (run.status !== "succeeded" || !result)
    return {
      ...base,
      label: run.status === "cancelled" ? "Cancelled" : "Unable to verify",
      detail: "The check did not produce a current result. Refresh Loan Footprint to try again.",
    };
  // Result status alone is insufficient: both the saved input and evaluated snapshot must agree.
  if (
    !input ||
    result.addressRevision !== input.addressRevision ||
    result.policyVersion !== input.policyVersion ||
    addressKey(result.address) !== addressKey(input.address)
  )
    return {
      ...base,
      stale: true,
      label: "Stale result",
      detail: "The evaluated address or policy changed. Refresh to load a current result.",
    };
  if (result.reason === "inside_us_demo" && run.outcome === "clear")
    return {
      ...base,
      clear: true,
      coordinates: result.coordinates,
      label: "Within the US lending footprint",
      detail: "This complete US address meets the country rule.",
    };
  if (result.reason === "outside_us_demo")
    return {
      ...base,
      coordinates: result.coordinates,
      label: "Outside the US lending footprint",
      detail:
        "The saved country is outside the US. This informational result does not block the application.",
    };
  return {
    ...base,
    label: "Needs address",
    detail: "The address could not be evaluated. Save a complete business address and try again.",
  };
}

export function footprintMapPoint(coordinates: { latitude: number; longitude: number } | null) {
  if (!coordinates) return null;
  const { latitude, longitude } = coordinates;
  // Bundled mainland-US schematic. Never invent a pin beyond its supported extent.
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < 24 ||
    latitude > 50 ||
    longitude < -126 ||
    longitude > -66
  )
    return null;
  return { left: ((longitude + 130) / 70) * 100, top: ((55 - latitude) / 35) * 100 };
}
