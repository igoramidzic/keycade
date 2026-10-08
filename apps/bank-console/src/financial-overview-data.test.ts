import type { FinancialCandidate, FinancialFact, FinancialFactsView } from "@keycade/contracts";
import { expect, test } from "vitest";
import {
  financialChartBars,
  financialMetricOverview,
  financialPeriodLabel,
  formatFinancialMoney,
} from "./financial-overview-data";

function fact(overrides: Partial<FinancialFact> = {}): FinancialFact {
  return {
    id: "review-2025",
    fieldKey: "revenue",
    label: "Revenue",
    metric: "revenue",
    value: "1500000.00",
    period: { start: "2025-01-01", end: "2025-12-31", basis: "fiscal_year" },
    currency: "USD",
    unit: "money",
    source: {
      documentId: "document-2025",
      versionId: "version-1",
      runId: "run-1",
      runGeneration: 1,
      categoryRevision: 0,
      analysisRevision: 0,
      sourcePage: 1,
      sourceLabel: "Revenue",
      recipeId: "business-tax-return-2025",
      recipeVersion: 1,
      sha256: "a".repeat(64),
    },
    disposition: "accept",
    factRevision: 1,
    originalCandidate: { key: "revenue", label: "Revenue", value: "1500000.00", kind: "money" },
    adjustments: [],
    businessSnapshot: {
      businessId: "business-1",
      businessName: "Synthetic Business",
      applicationRevision: 1,
    },
    reviewerUserId: "officer-1",
    reviewedAt: "2026-10-08T10:00:00.000Z",
    reason: "Reviewed synthetic evidence",
    simulated: true,
    sourceStale: false,
    ...overrides,
  };
}
function view(facts: FinancialFact[], candidates: FinancialCandidate[] = []): FinancialFactsView {
  return {
    applicationId: "application-1",
    applicationRevision: 1,
    canReview: true,
    simulated: true,
    facts,
    candidates,
    history: [],
  };
}
function candidate(overrides: Partial<FinancialCandidate> = {}): FinancialCandidate {
  return {
    ...fact(),
    currentFactRevision: 0,
    currentFactValue: null,
    canReview: true,
    unavailableReason: null,
    ...overrides,
  };
}

test("financial display retains cents and exact amounts above the safe integer range", () => {
  expect(formatFinancialMoney("999999999999999999.99")).toBe("$999,999,999,999,999,999.99");
  expect(formatFinancialMoney("-9007199254740993.09")).toBe("−$9,007,199,254,740,993.09");
  expect(formatFinancialMoney("0.00")).toBe("$0.00");
});

test("pending or rejected suggestions cannot create financial values, and ordinary income is not adjusted income", () => {
  const pending = view([], [candidate()]);
  pending.history.push({ ...fact(), disposition: "reject", factRevision: null });
  expect(financialMetricOverview(pending, "revenue")).toMatchObject({
    latest: null,
    state: "unconfirmed",
    series: [],
  });
  expect(
    financialMetricOverview(view([fact({ metric: "ordinary_income" })]), "adjusted_net_income"),
  ).toMatchObject({ latest: null, state: "missing", series: [] });
});

test("a stale reviewed latest period retains its amount and exact evidence instead of a new suggestion", () => {
  const stale = fact({ sourceStale: true, value: "1470000.15", disposition: "correct" });
  const prior = fact({
    id: "review-2023",
    period: { start: "2023-01-01", end: "2023-12-31", basis: "fiscal_year" },
  });
  const result = financialMetricOverview(
    view([prior, stale], [candidate({ value: "9999999.00" })]),
    "revenue",
  );
  expect(result.state).toBe("stale");
  expect(result.latest).toBe(stale);
  expect(result.latest?.source).toEqual(stale.source);
  expect(result.series[0]?.facts.map((item) => item.period.end)).toEqual([
    "2023-12-31",
    "2025-12-31",
  ]);
  expect(result.series[0]?.facts).toHaveLength(2);
});

test("period history separates business snapshots, fiscal calendars and statement bases", () => {
  const values = [
    fact(),
    fact({ id: "prior", period: { start: "2024-01-01", end: "2024-12-31", basis: "fiscal_year" } }),
    fact({ id: "short", period: { start: "2025-06-01", end: "2025-12-31", basis: "fiscal_year" } }),
    fact({
      id: "other-calendar",
      period: { start: "2024-07-01", end: "2025-06-30", basis: "fiscal_year" },
    }),
    fact({
      id: "statement",
      period: { start: "2025-01-01", end: "2025-01-31", basis: "statement" },
    }),
    fact({
      id: "other-business",
      businessSnapshot: {
        businessId: "business-2",
        businessName: "Other synthetic business",
        applicationRevision: 1,
      },
    }),
    fact({
      id: "old-name",
      businessSnapshot: {
        businessId: "business-1",
        businessName: "Previous synthetic name",
        applicationRevision: 1,
      },
    }),
  ];
  const result = financialMetricOverview(view(values), "revenue");
  expect(result.series).toHaveLength(6);
  expect(result.series.map((item) => item.facts.length).sort()).toEqual([1, 1, 1, 1, 1, 2]);
  expect(
    result.series.find((item) => item.facts.length === 2)?.facts.map((item) => item.id),
  ).toEqual(["prior", "review-2025"]);
});

test("calendar-month statement histories accommodate February without mixing partial-month periods", () => {
  const result = financialMetricOverview(
    view([
      fact({ period: { start: "2025-01-01", end: "2025-01-31", basis: "statement" } }),
      fact({ period: { start: "2025-02-01", end: "2025-02-28", basis: "statement" } }),
      fact({ period: { start: "2025-01-01", end: "2025-01-15", basis: "statement" } }),
    ]),
    "revenue",
  );
  expect(result.series.map((item) => item.facts.length)).toEqual([2, 1]);
  expect(financialPeriodLabel(result.series[0]?.facts[0]?.period ?? fact().period)).toBe(
    "Statement 2025-01-01 – 2025-01-31",
  );
  expect(financialPeriodLabel(fact().period)).toBe("Fiscal year 2025");
});

test("chart geometry handles negative, zero and very large exact decimals without non-finite values", () => {
  const result = financialChartBars([
    fact({ value: "-999999999999999999.99" }),
    fact({ value: "0.00" }),
    fact({ value: "999999999999999999.99" }),
  ]);
  expect(result.zero).toBe(50);
  expect(result.bars.map(({ from, width }) => ({ from, width }))).toEqual([
    { from: 0, width: 50 },
    { from: 50, width: 0 },
    { from: 50, width: 50 },
  ]);
  expect(financialChartBars([fact({ value: "0.00" })]).bars[0]?.width).toBe(0);
});
