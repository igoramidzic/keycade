import { describe, expect, it } from "vitest";
import { submissionFactsSchema } from "./review.js";

const legacyFacts = {
  businessName: "Synthetic historical workshop",
  productName: "Synthetic Business Credit",
  requestedAmount: "25000.00",
  currency: "USD",
  purpose: "Uncategorized historical purpose",
  industryCode: null,
  industryTaxonomyVersion: null,
};
describe("immutable submission intake facts", () => {
  it("reads historical facts with empty new projections without mutating their source", () => {
    const before = structuredClone(legacyFacts);
    expect(submissionFactsSchema.parse(legacyFacts)).toEqual({
      ...legacyFacts,
      businessAddress: null,
      businessAddressRevision: 0,
      website: null,
      fundingPurposes: [],
      purposeCatalogVersion: null,
      otherPurposeDetail: null,
    });
    expect(legacyFacts).toEqual(before);
  });
  it("retains address revisions and ordered versioned purposes in new snapshots", () => {
    const input = {
      ...legacyFacts,
      businessAddress: {
        line1: "42 Synthetic Avenue",
        locality: "Teston",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
      businessAddressRevision: 2,
      website: "https://example.test/",
      fundingPurposes: ["other", "equipment_purchase"],
      purposeCatalogVersion: "2026-01",
      otherPurposeDetail: "Synthetic workshop expansion",
    };
    expect(submissionFactsSchema.parse(input)).toEqual(input);
    expect(
      submissionFactsSchema.safeParse({ ...input, fundingPurposes: ["other", "other"] }).success,
    ).toBe(false);
  });
});
