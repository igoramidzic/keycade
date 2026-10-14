import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  centsToUsd,
  financingProductCatalog,
  financingProductFamilies,
  financingProductVariantSchema,
  financingSources,
  saveFinancingDraftSchema,
  saveFinancingRequestSchema,
  usdToCents,
} from "./financing.js";

const draft = (overrides: object = {}) => ({
  idempotencyKey: randomUUID(),
  expectedDraftRevision: null,
  facilities: [
    { key: "sba", family: "sba_7a", principal: "5000000.00" },
    { key: "conv", family: "conventional_term", security: "secured", principal: "4000000.00" },
  ],
  uses: [{ key: "build", category: "equipment_purchase", description: "Line", amount: "1.00" }],
  sources: [],
  allocations: [],
  lineage: [],
  ...overrides,
});

describe("financing catalog", () => {
  it("lists 19 researched types with only the three initial families executable", () => {
    expect(financingProductCatalog).toHaveLength(19);
    expect(new Set(financingProductCatalog.map((entry) => entry.key)).size).toBe(19);
    expect(financingProductCatalog.map((entry) => entry.number)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
    const initial = financingProductCatalog.filter((entry) => entry.support === "initial");
    expect(initial.map((entry) => entry.key).sort()).toEqual(
      [...financingProductVariantSchema.options].sort(),
    );
    expect(new Set(initial.map((entry) => entry.family))).toEqual(
      new Set(financingProductFamilies.map((family) => family.key)),
    );
    for (const entry of financingProductCatalog.filter((e) => e.support === "reference"))
      expect(entry.family).toBeNull();
    for (const entry of financingProductCatalog)
      for (const source of entry.sourceIds)
        expect(financingSources[source].accessedOn).toBe("2026-10-12");
    for (const family of financingProductFamilies)
      for (const variant of family.variants)
        expect(financingProductCatalog.find((entry) => entry.key === variant)?.family).toBe(
          family.key,
        );
  });
});

describe("exact USD amounts", () => {
  it("round-trips the largest numeric(20,2) amount without floating point", () => {
    expect(usdToCents("999999999999999999.99")).toBe(99999999999999999999n);
    expect(centsToUsd(99999999999999999999n)).toBe("999999999999999999.99");
    expect(centsToUsd(usdToCents("9000000.00") + usdToCents("0.01"))).toBe("9000000.01");
    expect(centsToUsd(5n)).toBe("0.05");
    expect(() => usdToCents("1.5")).toThrow();
    expect(() => centsToUsd(-1n)).toThrow();
  });
  it("rejects zero, negative, malformed and over-precise request amounts", () => {
    const base = { expectedRevision: 1, idempotencyKey: randomUUID(), productPreference: null };
    for (const requestedAmount of ["0.00", "-5.00", "1.001", "1e6", "9000000", " 9.00"])
      expect(saveFinancingRequestSchema.safeParse({ ...base, requestedAmount }).success).toBe(
        false,
      );
    expect(
      saveFinancingRequestSchema.safeParse({ ...base, requestedAmount: null }).success,
      "a request needs a need or a preference",
    ).toBe(false);
    expect(
      saveFinancingRequestSchema.parse({
        ...base,
        requestedAmount: "9000000.00",
        productPreference: "sba_7a",
      }).requestedAmount,
    ).toBe("9000000.00");
  });
});

describe("financing draft payloads", () => {
  it("accepts any number of facilities without a fixed pairing", () => {
    expect(saveFinancingDraftSchema.safeParse(draft()).success).toBe(true);
    const three = draft({
      facilities: [
        { key: "a", family: "equipment_term", principal: "1.00" },
        { key: "b", family: "equipment_term", principal: "2.00" },
        { key: "c", family: "sba_7a", principal: null },
      ],
    });
    expect(saveFinancingDraftSchema.safeParse(three).success).toBe(true);
  });
  it("rejects duplicate cost allocation, unknown references and zero amounts", () => {
    const allocation = { useKey: "build", facilityKey: "sba", amount: "1.00" };
    expect(
      saveFinancingDraftSchema.safeParse(draft({ allocations: [allocation, allocation] })).success,
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({ allocations: [{ ...allocation, facilityKey: "missing" }] }),
      ).success,
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({ allocations: [{ ...allocation, sourceKey: "equity" }] }),
      ).success,
      "exactly one funder",
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({ facilities: [{ key: "sba", family: "sba_7a", principal: "0.00" }] }),
      ).success,
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({
          facilities: [{ key: "x", family: "sba_7a", security: "secured", principal: null }],
        }),
      ).success,
      "security applies only to conventional term",
    ).toBe(false);
  });
  it("requires lineage shapes and new successors", () => {
    const facilityId = randomUUID();
    const split = {
      kind: "split",
      predecessorFacilityIds: [facilityId],
      successorKeys: ["sba", "conv"],
    };
    expect(saveFinancingDraftSchema.safeParse(draft({ lineage: [split] })).success).toBe(true);
    expect(
      saveFinancingDraftSchema.safeParse(draft({ lineage: [{ ...split, successorKeys: ["sba"] }] }))
        .success,
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({
          lineage: [
            { kind: "combine", predecessorFacilityIds: [facilityId], successorKeys: ["sba"] },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      saveFinancingDraftSchema.safeParse(
        draft({
          facilities: [
            { key: "sba", facilityId, family: "sba_7a", principal: "1.00" },
            { key: "conv", family: "equipment_term", principal: "1.00" },
          ],
          lineage: [split],
        }),
      ).success,
      "a split facility cannot also continue",
    ).toBe(false);
  });
});
