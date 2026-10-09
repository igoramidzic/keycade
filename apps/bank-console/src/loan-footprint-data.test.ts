import type { BusinessAddress, CheckResult } from "@keycade/contracts";
import { expect, test } from "vitest";
import {
  footprintMapPoint,
  type LoanFootprintCheck,
  loanFootprintDisplay,
} from "./loan-footprint-data";

const address: BusinessAddress = {
  line1: "123 Synthetic Avenue",
  locality: "Portland",
  region: "ME",
  postalCode: "04101",
  countryCode: "US",
};
const coordinates = {
  latitude: 43.6591,
  longitude: -70.2568,
  label: "Synthetic Portland fixture",
  source: "registered_synthetic_fixture" as const,
};
const footprintInput = { addressRevision: 2, address, policyVersion: "US-only-demo-v1" as const };
const evidence: CheckResult = {
  provider: "keycade-checks-v1",
  simulated: true,
  kind: "loan_footprint",
  operationId: "operation-current",
  fingerprint: "a".repeat(64),
  completedAt: "2026-10-08T12:00:00.000Z",
  outcome: "clear",
  findings: ["synthetic_match"],
  footprint: { ...footprintInput, countryCode: "US", reason: "inside_us_demo", coordinates },
};
type Run = LoanFootprintCheck["runs"][number];
function check(overrides: Partial<Run> = {}): LoanFootprintCheck {
  return {
    id: "footprint",
    kind: "loan_footprint",
    title: "Loan Footprint",
    stage: "approval",
    required: false,
    subjectUserId: null,
    subjectRelationshipId: null,
    currentRunId: "current-run",
    passes: true,
    canRetry: false,
    canRefresh: true,
    canResolve: false,
    runs: [
      {
        id: "current-run",
        status: "succeeded",
        stale: false,
        attempts: 1,
        missingPrerequisites: [],
        outcome: "clear",
        evidence,
        footprintInput,
        errorCode: null,
        resolved: false,
        resolution: null,
        createdAt: "2026-10-08T12:00:00.000Z",
        updatedAt: "2026-10-08T12:00:00.000Z",
        ...overrides,
      },
    ],
  };
}

test("a current successful US footprint is clear regardless of registered map coordinates", () => {
  expect(loanFootprintDisplay(check(), address)).toMatchObject({ clear: true, coordinates });
  const missingMap = { ...evidence, footprint: { ...evidence.footprint!, coordinates: null } };
  expect(loanFootprintDisplay(check({ evidence: missingMap }), address)).toMatchObject({
    clear: true,
    coordinates: null,
    label: "Within the US lending footprint",
  });
});

test.each([
  "waiting_for_input",
  "queued",
  "running",
  "retry_scheduled",
  "failed",
  "timed_out",
  "cancelled",
] as const)("%s never reuses a previous clear outcome or registered pin", (status) => {
  expect(loanFootprintDisplay(check({ status }), address)).toMatchObject({
    clear: false,
    coordinates: null,
  });
});

test("stale and unavailable current results cannot display successful evidence", () => {
  expect(loanFootprintDisplay(check({ stale: true }), address)).toMatchObject({
    clear: false,
    coordinates: null,
    label: "Stale result",
  });
  expect(loanFootprintDisplay(check(), address, true)).toMatchObject({
    clear: false,
    coordinates: null,
    label: "Status unavailable",
  });
  expect(loanFootprintDisplay(check({ evidence: null }), address)).toMatchObject({
    clear: false,
    coordinates: null,
  });
});

test("changed saved input, case, or field boundaries invalidate a cached green result immediately", () => {
  for (const changed of [
    { ...address, line1: "Different address" },
    { ...address, line1: "123 synthetic avenue" },
    { ...address, line1: "123 Synthetic Avenue, Portland", locality: "ME", region: "" },
    { ...address, line2: "Suite 2" },
    null,
  ])
    expect(loanFootprintDisplay(check(), changed)).toMatchObject({
      clear: false,
      coordinates: null,
      stale: true,
    });
});

test("a result for a different address revision or snapshot remains stale", () => {
  for (const changed of [
    { ...evidence.footprint!, addressRevision: 1 },
    { ...evidence.footprint!, address: { ...address, postalCode: "04102" } },
  ])
    expect(
      loanFootprintDisplay(check({ evidence: { ...evidence, footprint: changed } }), address),
    ).toMatchObject({
      clear: false,
      coordinates: null,
      stale: true,
    });
});

test("a non-US result is informational and not clear; missing addresses need input", () => {
  const outside = { ...address, countryCode: "CA" };
  const outsideInput = { ...footprintInput, address: outside };
  expect(
    loanFootprintDisplay(
      check({
        footprintInput: outsideInput,
        outcome: "needs_review",
        evidence: {
          ...evidence,
          outcome: "needs_review",
          footprint: {
            ...outsideInput,
            countryCode: "CA",
            reason: "outside_us_demo",
            coordinates: null,
          },
        },
      }),
      outside,
    ),
  ).toMatchObject({ clear: false, label: "Outside the US lending footprint", coordinates: null });
  expect(
    loanFootprintDisplay(
      check({
        status: "waiting_for_input",
        footprintInput: { ...footprintInput, address: null },
        evidence: null,
      }),
      null,
    ),
  ).toMatchObject({ clear: false, label: "Needs address", coordinates: null });
});

test("the bundled schematic only projects finite registered coordinates within its supported extent", () => {
  const point = footprintMapPoint(coordinates);
  expect(point?.left).toBeGreaterThan(0);
  expect(point?.left).toBeLessThan(100);
  expect(point?.top).toBeGreaterThan(0);
  expect(point?.top).toBeLessThan(100);
  for (const unavailable of [
    null,
    { latitude: Number.NaN, longitude: -70 },
    { latitude: 89, longitude: -70 },
    { latitude: 43, longitude: -179 },
  ])
    expect(footprintMapPoint(unavailable)).toBeNull();
});
