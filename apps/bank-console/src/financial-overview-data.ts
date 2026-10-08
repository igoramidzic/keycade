import type { FinancialFact, FinancialFactsView, FinancialMetric } from "@keycade/contracts";

export const overviewFinancialMetrics = [
  { metric: "revenue", label: "Revenue" },
  { metric: "adjusted_net_income", label: "Adjusted net income" },
] as const;

/** Keep the full decimal precision, including amounts beyond Number's safe range. */
export function formatFinancialMoney(value: string) {
  const negative = value.startsWith("-");
  const [whole, cents] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "−" : ""}$${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function financialPeriodLabel(period: FinancialFact["period"]) {
  if (
    period.basis === "fiscal_year" &&
    period.start.endsWith("-01-01") &&
    period.end === `${period.start.slice(0, 4)}-12-31`
  )
    return `Fiscal year ${period.start.slice(0, 4)}`;
  return `${period.basis === "fiscal_year" ? "Fiscal period" : "Statement"} ${period.start} – ${period.end}`;
}

function periodShape(period: FinancialFact["period"]) {
  if (period.basis === "fiscal_year")
    return [
      period.start.slice(5),
      period.end.slice(5),
      Number(period.end.slice(0, 4)) - Number(period.start.slice(0, 4)),
    ];
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  const next = new Date(end.valueOf() + 86_400_000);
  if (
    start.getUTCDate() === 1 &&
    next.getUTCDate() === 1 &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
  )
    return ["calendar_month"];
  return ["days", (end.valueOf() - start.valueOf()) / 86_400_000 + 1];
}

export function financialSeriesKey(fact: FinancialFact) {
  return JSON.stringify([
    fact.businessSnapshot.businessId,
    fact.businessSnapshot.businessName,
    fact.metric,
    fact.currency,
    fact.unit,
    fact.period.basis,
    ...periodShape(fact.period),
  ]);
}

export function financialMetricOverview(view: FinancialFactsView, metric: FinancialMetric) {
  const facts = view.facts
    .filter((fact) => fact.metric === metric)
    .sort(
      (a, b) =>
        b.period.end.localeCompare(a.period.end) ||
        b.period.start.localeCompare(a.period.start) ||
        b.reviewedAt.localeCompare(a.reviewedAt),
    );
  const latest = facts[0] ?? null;
  const state: "stale" | "current" | "unconfirmed" | "missing" = latest
    ? latest.sourceStale
      ? "stale"
      : "current"
    : view.candidates.some((candidate) => candidate.metric === metric)
      ? "unconfirmed"
      : "missing";
  const series = new Map<string, FinancialFact[]>();
  for (const fact of facts) {
    const key = financialSeriesKey(fact);
    const values = series.get(key) ?? [];
    values.unshift(fact);
    series.set(key, values);
  }
  return { latest, state, series: [...series].map(([key, facts]) => ({ key, facts })) };
}

/** Geometry only uses rounded ratios; the labels/table retain the exact money string. */
export function financialChartBars(facts: FinancialFact[]) {
  const cents = facts.map((fact) => BigInt(fact.value.replace(".", "")));
  const min = cents.reduce((result, value) => (value < result ? value : result), 0n);
  const max = cents.reduce((result, value) => (value > result ? value : result), 0n);
  const range = max - min || 1n;
  const position = (value: bigint) => Number(((value - min) * 10_000n) / range) / 100;
  const zero = position(0n);
  return {
    zero,
    bars: facts.map((fact, index) => {
      const point = position(cents[index] ?? 0n);
      return { fact, from: Math.min(point, zero), width: Math.abs(point - zero) };
    }),
  };
}
