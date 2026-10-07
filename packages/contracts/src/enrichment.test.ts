import { describe, expect, it } from "vitest";
import {
  authorizeTaxSchema,
  enrichmentResultSchema,
  requestEnrichmentSchema,
  retryEnrichmentSchema,
  saveIdentifierSchema,
} from "./enrichment.js";

describe("private enrichment wire contracts", () => {
  it("accepts only registered synthetic identifiers and rejects public scenario controls", () => {
    expect(saveIdentifierSchema.parse({ expectedRevision: 0, value: "000000001" })).toEqual({
      expectedRevision: 0,
      value: "000000001",
    });
    for (const value of ["123456789", "12-3456789", "000000008", 123456789])
      expect(saveIdentifierSchema.safeParse({ expectedRevision: 0, value }).success).toBe(false);
    expect(
      saveIdentifierSchema.safeParse({
        expectedRevision: 0,
        value: "000000001",
        scenario: "success",
      }).success,
    ).toBe(false);
    expect(
      requestEnrichmentSchema.safeParse({ expectedRevision: 0, kind: "tax", scenario: "success" })
        .success,
    ).toBe(false);
  });
  it("requires explicit current notice acknowledgement and safe retry reasons", () => {
    expect(authorizeTaxSchema.safeParse({ expectedRevision: 1, authorized: true }).success).toBe(
      false,
    );
    expect(
      authorizeTaxSchema.safeParse({
        expectedRevision: 1,
        authorized: true,
        noticeVersion: "real-consent",
      }).success,
    ).toBe(false);
    expect(retryEnrichmentSchema.safeParse({ reason: "000000001" }).success).toBe(false);
    expect(retryEnrichmentSchema.parse({ reason: "timeout" })).toEqual({ reason: "timeout" });
  });
  it("rejects provider result extensions containing identifiers or unsupported facts", () => {
    const result = {
      provider: "keycade-enrichment-v1",
      simulated: true,
      kind: "business",
      operationId: "10000000-0000-4000-8000-000000000001",
      inputRevision: 1,
      completedAt: "2026-10-07T12:00:00Z",
      outcome: "complete",
      suggestions: [],
      taxRecords: [],
    };
    expect(enrichmentResultSchema.safeParse(result).success).toBe(true);
    expect(enrichmentResultSchema.safeParse({ ...result, identifier: "000000001" }).success).toBe(
      false,
    );
    expect(enrichmentResultSchema.safeParse({ ...result, simulated: false }).success).toBe(false);
    expect(
      enrichmentResultSchema.safeParse({
        ...result,
        suggestions: [{ key: "ssn", value: "000000001" }],
      }).success,
    ).toBe(false);
  });
});
