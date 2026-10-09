import { describe, expect, it } from "vitest";
import { createDraftSchema, saveApplicationSetupSchema } from "./applications.js";
import {
  businessAddressSchema,
  businessWebsiteSchema,
  fundingPurposeOptions,
  fundingPurposesSchema,
} from "./setup-catalog.js";

const address = {
  line1: " 42 Synthetic Avenue ",
  locality: "Teston",
  region: "NY",
  postalCode: "10001",
  countryCode: " us ",
};
describe("v2 setup wire validation", () => {
  it("normalizes explicit country and website while retaining a non-US address", () => {
    expect(businessAddressSchema.parse(address)).toMatchObject({
      line1: "42 Synthetic Avenue",
      countryCode: "US",
    });
    expect(businessAddressSchema.parse({ ...address, countryCode: "ca" }).countryCode).toBe("CA");
    expect(businessWebsiteSchema.parse(" https://EXAMPLE.TEST ")).toBe("https://example.test/");
    for (const website of [
      "",
      "not a website",
      "example",
      "//example.test",
      "user@example.test",
      "user:password@example.test",
      "example.test:badport",
      "example.test\\@other.test",
      "https://",
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://example.test",
      "https://user:password@example.test",
    ])
      expect(businessWebsiteSchema.safeParse(website).success).toBe(false);
    expect(businessAddressSchema.safeParse({ ...address, countryCode: "" }).success).toBe(false);
    expect(businessAddressSchema.safeParse({ ...address, locality: " " }).success).toBe(false);
  });
  it.each([
    ["kualia.com", "https://kualia.com/"],
    ["  WWW.EXAMPLE.TEST  ", "https://www.example.test/"],
    ["example.test/about?source=setup#team", "https://example.test/about?source=setup#team"],
    ["example.test:8443/about", "https://example.test:8443/about"],
    ["http://EXAMPLE.TEST/about", "http://example.test/about"],
    ["https://example.test", "https://example.test/"],
  ])("accepts %s and saves a canonical website", (input, expected) => {
    expect(businessWebsiteSchema.parse(input)).toBe(expected);
    expect(businessWebsiteSchema.parse(expected)).toBe(expected);
    expect(
      saveApplicationSetupSchema.parse({
        definitionVersion: 2,
        expectedRevision: 1,
        answers: { website: input },
        currentStep: "website",
      }).answers,
    ).toEqual({ website: expected });
  });
  it("retains purpose order, rejects unknown/duplicate codes and never accepts raw identifiers", () => {
    const values = ["equipment_purchase", "working_capital"];
    expect(fundingPurposesSchema.parse(values)).toEqual(values);
    expect(fundingPurposeOptions).toHaveLength(11);
    expect(
      fundingPurposesSchema.safeParse(["equipment_purchase", "equipment_purchase"]).success,
    ).toBe(false);
    expect(fundingPurposesSchema.safeParse(["approve_me"]).success).toBe(false);
    expect(
      saveApplicationSetupSchema.safeParse({
        definitionVersion: 2,
        expectedRevision: 1,
        answers: { ein: "00-0000000" },
        currentStep: "industry",
      }).success,
    ).toBe(false);
    expect(
      createDraftSchema.safeParse({
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        answers: { businessEin: "00-0000000" },
      }).success,
    ).toBe(false);
  });
  it("supports explicit website clearing independently of other saved answers", () => {
    expect(
      saveApplicationSetupSchema.parse({
        definitionVersion: 2,
        expectedRevision: 3,
        answers: { website: null },
        currentStep: "website",
      }).answers,
    ).toEqual({ website: null });
  });
});
