import { randomUUID } from "node:crypto";
import { financingPolicyFixtures } from "@keylend/db";
import { describe, expect, it } from "vitest";
import {
  evaluateFinancingStructure,
  type FinancingEvaluationInput,
  type FinancingPolicySnapshot,
  resolveFinancingPolicy,
} from "./financing.js";

const today = "2026-10-13";
const policies: FinancingPolicySnapshot[] = financingPolicyFixtures.map((policy) => ({
  ...policy,
  id: randomUUID(),
  active: true,
}));
const policy = (variant: string) => policies.find((p) => p.variant === variant) ?? null;
const request = {
  id: randomUUID(),
  requestedAmount: "9000000.00",
  authorKind: "applicant" as const,
};
type Facility = FinancingEvaluationInput["facilities"][number];
const facility = (
  family: Facility["family"],
  principal: string | null,
  security: Facility["security"] = family === "conventional_term" ? "secured" : null,
): Facility => ({
  facilityId: randomUUID(),
  family,
  security,
  principal,
  policy: resolveFinancingPolicy(policies, { family, security, principal }, today),
});
const evaluate = (input: Partial<FinancingEvaluationInput>) =>
  evaluateFinancingStructure({
    today,
    request,
    facilities: [],
    uses: [],
    sources: [],
    allocations: [],
    ...input,
  });
const codes = (result: ReturnType<typeof evaluate>) => result.findings.map((f) => f.code);

describe("server-side variant resolution", () => {
  it("resolves SBA 7(a) by principal under the pinned limits and conventional by security", () => {
    const sba = (principal: string | null) =>
      resolveFinancingPolicy(policies, { family: "sba_7a", security: null, principal }, today)
        ?.variant ?? null;
    expect(sba("300000.00")).toBe("sba_7a_small");
    expect(sba("350000.00")).toBe("sba_7a_small");
    expect(sba("350000.01")).toBe("sba_7a_standard");
    expect(sba("5000000.00")).toBe("sba_7a_standard");
    expect(sba("6000000.00"), "an over-limit request pins the largest variant").toBe(
      "sba_7a_standard",
    );
    expect(sba(null)).toBeNull();
    const conventional = (security: "secured" | "unsecured" | null) =>
      resolveFinancingPolicy(
        policies,
        { family: "conventional_term", security, principal: "1.00" },
        today,
      )?.variant ?? null;
    expect(conventional("secured")).toBe("conventional_term_secured");
    expect(conventional("unsecured")).toBe("conventional_term_unsecured");
    expect(conventional(null)).toBeNull();
  });
  it("uses only current policy versions and prefers the latest", () => {
    const equipment = policy("equipment_term") as FinancingPolicySnapshot;
    const next = { ...equipment, id: randomUUID(), version: 2 };
    const resolve = (rows: FinancingPolicySnapshot[], on = today) =>
      resolveFinancingPolicy(
        rows,
        { family: "equipment_term", security: null, principal: "1.00" },
        on,
      )?.id;
    expect(resolve([equipment, next])).toBe(next.id);
    expect(resolve([equipment, { ...next, active: false }])).toBe(equipment.id);
    expect(resolve([equipment, { ...next, effectiveOn: "2027-01-01" }])).toBe(equipment.id);
    expect(resolve([{ ...equipment, expiresOn: today }])).toBeUndefined();
    expect(resolve([equipment], "2026-10-11"), "not yet effective").toBeUndefined();
  });
});

describe("financing structure evaluation", () => {
  it("accepts a $9M request split into $5M SBA 7(a) and $4M conventional for publication only", () => {
    const result = evaluate({
      facilities: [facility("sba_7a", "5000000.00"), facility("conventional_term", "4000000.00")],
    });
    expect(result.totals).toEqual({
      requestedNeed: "9000000.00",
      financing: "9000000.00",
      contributions: "0.00",
      projectCost: null,
      financingGap: "0.00",
      financingExcess: "0.00",
      unallocatedCost: "0.00",
    });
    expect(result.ready).toEqual({ publication: true, approval: false, funding: false });
    expect(codes(result).sort()).toEqual(
      [
        "credit_decision_unavailable",
        "funding_unavailable",
        "program_exposure_unknown",
        "uses_missing",
      ].sort(),
    );
  });
  it("saves but blocks a $6M single 7(a) facility at its sourced program maximum", () => {
    const sba = facility("sba_7a", "6000000.00");
    const result = evaluate({ facilities: [sba, facility("conventional_term", "3000000.00")] });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "facility_above_maximum",
        facilityId: sba.facilityId,
        amount: "5000000.00",
        basis: "program_restriction",
        blocks: ["publication", "approval", "funding"],
      }),
    );
    expect(codes(result)).toContain("program_aggregate_exceeded");
    expect(result.ready).toEqual({ publication: false, approval: false, funding: false });
  });
  it("does not let several 7(a) facilities avoid the package limit", () => {
    const result = evaluate({
      facilities: [
        facility("sba_7a", "3000000.00"),
        facility("sba_7a", "300000.00"),
        facility("sba_7a", "2000000.00"),
        facility("conventional_term", "3700000.00"),
      ],
    });
    expect(result.findings.filter((f) => f.code === "facility_above_maximum")).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "program_aggregate_exceeded",
        amount: "5000000.00",
        basis: "fixture_assumption",
      }),
    );
  });
  it("blocks an unexplained gap but accepts a documented other source as reduced financing", () => {
    const sba = facility("sba_7a", "5000000.00");
    const conv = facility("conventional_term", "3000000.00");
    const gap = evaluate({ facilities: [sba, conv] });
    expect(gap.findings).toContainEqual(
      expect.objectContaining({ code: "financing_gap", amount: "1000000.00" }),
    );
    expect(gap.ready.publication).toBe(false);
    const use = { id: randomUUID(), amount: "9000000.00" };
    const seller = { id: randomUUID(), amount: "1000000.00" };
    const covered = evaluate({
      facilities: [sba, conv],
      uses: [use],
      sources: [seller],
      allocations: [
        { useId: use.id, facilityId: sba.facilityId, sourceId: null, amount: "5000000.00" },
        { useId: use.id, facilityId: conv.facilityId, sourceId: null, amount: "3000000.00" },
        { useId: use.id, facilityId: null, sourceId: seller.id, amount: "1000000.00" },
      ],
    });
    expect(covered.totals).toMatchObject({
      financing: "8000000.00",
      contributions: "1000000.00",
      projectCost: "9000000.00",
      financingGap: "1000000.00",
      unallocatedCost: "0.00",
    });
    expect(covered.findings).toContainEqual(
      expect.objectContaining({ code: "reduced_financing", blocks: [], amount: "1000000.00" }),
    );
    expect(codes(covered)).not.toContain("financing_gap");
    expect(covered.ready.publication).toBe(true);
  });
  it("separates package totals, project cost, contributions and allocation completeness", () => {
    const sba = facility("sba_7a", "5000000.00");
    const conv = facility("conventional_term", "4000000.00");
    const equipment = { id: randomUUID(), amount: "6000000.00" };
    const capital = { id: randomUUID(), amount: "4000000.00" };
    const equity = { id: randomUUID(), amount: "1000000.00" };
    const result = evaluate({
      facilities: [sba, conv],
      uses: [equipment, capital],
      sources: [equity],
      allocations: [
        { useId: equipment.id, facilityId: sba.facilityId, sourceId: null, amount: "5000000.00" },
        { useId: equipment.id, facilityId: null, sourceId: equity.id, amount: "1000000.00" },
        { useId: capital.id, facilityId: conv.facilityId, sourceId: null, amount: "3999999.99" },
      ],
    });
    expect(result.totals).toMatchObject({
      financing: "9000000.00",
      contributions: "1000000.00",
      projectCost: "10000000.00",
      unallocatedCost: "0.01",
    });
    expect(codes(result)).toContain("allocation_incomplete");
    expect(result.ready.publication).toBe(true);
    const unreconciled = evaluate({ facilities: [sba, conv], uses: [equipment], sources: [] });
    expect(unreconciled.findings).toContainEqual(
      expect.objectContaining({ code: "uses_unreconciled", amount: "3000000.00" }),
    );
    expect(unreconciled.ready.publication).toBe(false);
  });
  it("supports three facilities and flags need, amount, product and policy gaps", () => {
    const three = evaluate({
      facilities: [
        facility("sba_7a", "5000000.00"),
        facility("conventional_term", "3000000.00"),
        facility("equipment_term", "1000000.00"),
      ],
    });
    expect(three.totals.financing).toBe("9000000.00");
    expect(three.ready.publication).toBe(true);
    const incomplete = evaluate({
      request: { ...request, requestedAmount: null, authorKind: "staff" },
      facilities: [
        facility("sba_7a", null),
        facility("conventional_term", "20000.00", null),
        facility("equipment_term", "9999.99"),
      ],
    });
    expect(codes(incomplete)).toEqual(
      expect.arrayContaining([
        "request_need_missing",
        "request_unconfirmed",
        "facility_amount_missing",
        "facility_security_missing",
        "facility_below_minimum",
      ]),
    );
    expect(codes(evaluate({ facilities: [] }))).toContain("no_facilities");
    const exceeds = evaluate({ facilities: [facility("conventional_term", "9000000.01")] });
    expect(exceeds.findings).toContainEqual(
      expect.objectContaining({ code: "financing_exceeds_request", amount: "0.01" }),
    );
    const overdue = evaluateFinancingStructure({
      today: "2027-04-13",
      request,
      facilities: [facility("conventional_term", "9000000.00")],
      uses: [],
      sources: [],
      allocations: [],
    });
    expect(overdue.findings).toContainEqual(
      expect.objectContaining({
        code: "product_policy_review_overdue",
        blocks: ["approval", "funding"],
      }),
    );
    const stale = evaluate({
      structureRequestId: randomUUID(),
      facilities: [facility("conventional_term", "9000000.00")],
    });
    expect(stale.findings).toContainEqual(
      expect.objectContaining({ code: "request_changed", blocks: ["publication"] }),
    );
    const unpinned = evaluate({
      facilities: [{ ...facility("equipment_term", "9000000.00"), policy: null }],
    });
    expect(codes(unpinned)).toContain("product_policy_unavailable");
  });
  it("sums the largest exact amounts without losing a cent", () => {
    const big = "999999999999999999.99";
    const result = evaluate({
      request: { ...request, requestedAmount: big },
      facilities: [
        { ...facility("conventional_term", "999999999999999999.98"), policy: null },
        { ...facility("conventional_term", "0.01"), policy: null },
      ],
    });
    expect(result.totals.financing).toBe(big);
    expect(result.totals.financingGap).toBe("0.00");
  });
});
