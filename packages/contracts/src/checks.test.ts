import { describe, expect, it } from "vitest";
import {
  captureTaskIdentifierSchema,
  checkResultSchema,
  resolveCheckSchema,
  retryCheckSchema,
} from "./checks.js";

describe("private checks contract", () => {
  it("accepts only registered synthetic input without a client-selected result", () => {
    expect(
      captureTaskIdentifierSchema.safeParse({
        expectedRevision: 1,
        expectedInputRevision: 0,
        value: "000000001",
      }).success,
    ).toBe(true);
    expect(
      captureTaskIdentifierSchema.safeParse({
        expectedRevision: 1,
        expectedInputRevision: 0,
        value: "123456789",
      }).success,
    ).toBe(false);
    expect(
      captureTaskIdentifierSchema.safeParse({
        expectedRevision: 1,
        expectedInputRevision: 0,
        value: "000000001",
        outcome: "clear",
      }).success,
    ).toBe(false);
  });
  it("allows only safe explicit resolution/retry reasons", () => {
    const runId = "10000000-0000-4000-8000-000000000001";
    expect(
      resolveCheckSchema.safeParse({ runId, reason: "reviewed_synthetic_evidence" }).success,
    ).toBe(true);
    expect(resolveCheckSchema.safeParse({ runId, reason: "approve" }).success).toBe(false);
    expect(retryCheckSchema.safeParse({ runId, reason: "identifier is 123456789" }).success).toBe(
      false,
    );
  });
  it("rejects arbitrary provider findings and identifiers", () => {
    const data = {
      provider: "keycade-checks-v1",
      simulated: true,
      kind: "identity",
      operationId: "10000000-0000-4000-8000-000000000001",
      fingerprint: "a".repeat(64),
      completedAt: "2026-10-07T12:00:00.000Z",
      outcome: "clear",
      findings: ["synthetic_match"],
    };
    expect(checkResultSchema.safeParse(data).success).toBe(true);
    expect(
      checkResultSchema.safeParse({ ...data, findings: ["free-form sensitive record"] }).success,
    ).toBe(false);
    expect(checkResultSchema.safeParse({ ...data, identifier: "000000001" }).success).toBe(false);
  });
});

it("requires address-bound footprint evidence and rejects mismatched country eligibility", () => {
  const data = {
    provider: "keycade-checks-v1",
    simulated: true,
    kind: "loan_footprint",
    operationId: "10000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
    completedAt: "2026-10-08T12:00:00.000Z",
    outcome: "clear",
    findings: ["synthetic_match"],
    footprint: {
      addressRevision: 2,
      policyVersion: "US-only-demo-v1",
      address: {
        line1: "Synthetic road",
        locality: "Synthetic city",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
      countryCode: "US",
      reason: "inside_us_demo",
      coordinates: null,
    },
  };
  expect(checkResultSchema.safeParse(data).success).toBe(true);
  expect(checkResultSchema.safeParse({ ...data, footprint: undefined }).success).toBe(false);
  expect(checkResultSchema.safeParse({ ...data, kind: "identity" }).success).toBe(false);
  expect(
    checkResultSchema.safeParse({
      ...data,
      footprint: { ...data.footprint, address: { ...data.footprint.address, countryCode: "CA" } },
    }).success,
  ).toBe(false);
  expect(
    checkResultSchema.safeParse({
      ...data,
      footprint: {
        ...data.footprint,
        coordinates: {
          latitude: Infinity,
          longitude: 1,
          label: "Synthetic",
          source: "registered_synthetic_fixture",
        },
      },
    }).success,
  ).toBe(false);
});
