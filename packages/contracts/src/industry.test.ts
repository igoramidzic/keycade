import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { saveApplicationSetupSchema } from "./applications.js";
import {
  industryByCode,
  industryCatalog,
  industryTaxonomyVersion,
  isValidIndustry,
} from "./industry.js";
import { searchIndustries } from "./industry-search.js";

describe("2022 U.S. industry catalog", () => {
  it("contains the complete official six-digit catalog with stable provenance", () => {
    expect(industryCatalog).toHaveLength(1012);
    expect(new Set(industryCatalog.map((item) => item.code)).size).toBe(1012);
    expect(
      industryCatalog.every(
        (item) => /^\d{6}$/.test(item.code) && item.title && item.taxonomyVersion === "2022",
      ),
    ).toBe(true);
    // A changed source requires intentional review/version handling, not silent replacement.
    expect(
      createHash("sha256")
        .update(JSON.stringify(industryCatalog.map(({ code, title }) => [code, title])))
        .digest("hex"),
    ).toBe("823bebe0e0ec637f261a737bd389528fc56f0514e453daa6a9f148712bf86466");
    expect(industryByCode("621210")).toEqual({
      code: "621210",
      title: "Offices of Dentists",
      taxonomyVersion: "2022",
    });
  });

  it.each([
    "621210",
    "dentistry office",
    "dental office",
    "dentist",
    "dentits",
    "dentstry ofice",
    "orthodontist",
  ])("finds the dental classification for %s", (query) => {
    expect(searchIndustries(query)[0]?.code).toBe("621210");
  });

  it.each([
    ["plumber", "238220"],
    ["hairdresser", "812112"],
    ["bookkeeper", "541219"],
    ["app developer", "541511"],
    ["coffee shop", "722515"],
  ])("supports everyday descriptions: %s", (query, code) => {
    expect(searchIndustries(query)[0]?.code).toBe(code);
  });

  it("ranks exact codes first, handles prefixes and bounds result counts", () => {
    expect(searchIndustries("541511").map((item) => item.code)).toEqual(["541511"]);
    expect(searchIndustries("621").every((item) => item.code.startsWith("621"))).toBe(true);
    expect(searchIndustries("", 1000)).toHaveLength(100);
    expect(searchIndustries("")).toHaveLength(30);
    expect(searchIndustries("dentistry office")).toEqual(searchIndustries(" DENTISTRY OFFICE "));
  });

  it.each(["999999", "zzzxxyykkqq", "dentistry spaceship", "!@#$", "a company"])(
    "does not invent results for %s",
    (query) => {
      expect(searchIndustries(query)).toEqual([]);
    },
  );

  it("accepts only explicitly supplied valid code/version pairs or a paired skip", () => {
    const input = { expectedRevision: 1, currentStep: "review" };
    for (const answers of [
      {},
      { industryCode: null, industryTaxonomyVersion: null },
      { industryCode: "621210", industryTaxonomyVersion },
    ])
      expect(saveApplicationSetupSchema.safeParse({ ...input, answers }).success).toBe(true);
    for (const answers of [
      { industryCode: "621210" },
      { industryTaxonomyVersion },
      { industryCode: "621210", industryTaxonomyVersion: "2017" },
      { industryCode: "999999", industryTaxonomyVersion },
      { industryCode: "23", industryTaxonomyVersion: "NAICS-demo-2022-v1" },
      { industryCode: "dentistry office", industryTaxonomyVersion },
      { industryCode: null, industryTaxonomyVersion },
    ])
      expect(saveApplicationSetupSchema.safeParse({ ...input, answers }).success).toBe(false);
    expect(isValidIndustry("621210", "2022")).toBe(true);
    expect(isValidIndustry("621210", "2027")).toBe(false);
  });
});
