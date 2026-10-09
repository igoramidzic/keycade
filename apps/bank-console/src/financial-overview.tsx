import type { FinancialFact, FinancialFactsView } from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import { Card } from "@keycade/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { SectionHeading } from "@keycade/ui/components/page-header";
import { cn } from "@keycade/ui/lib/utils";
import { ChevronDown, FileSearch } from "lucide-react";
import { useId, useState } from "react";
import {
  financialChartBars,
  financialMetricOverview,
  financialPeriodLabel,
  formatFinancialMoney,
  overviewFinancialMetrics,
} from "./financial-overview-data";

type SourceAction = (documentId: string, versionId: string, runId?: string) => void;
const stateLabels = {
  current: "Current reviewed value",
  stale: "Stale source · Review required",
  unconfirmed: "Unconfirmed",
  missing: "Missing",
};
const stateVariants = {
  current: "success",
  stale: "warning",
  unconfirmed: "info",
  missing: "secondary",
} as const;

export function FinancialOverview({
  financialFacts,
  onOpenSource,
}: {
  financialFacts: FinancialFactsView;
  onOpenSource: SourceAction;
}) {
  return (
    <section aria-label="Financial overview" className="space-y-4">
      <SectionHeading
        title="Financial overview"
        description="Values reflect explicit lender review of supplied document facts. Select a card to inspect available periods and their evidence."
        actions={<Badge variant="outline">Synthetic demo data</Badge>}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {overviewFinancialMetrics.map(({ metric, label }) => (
          <MetricCard
            key={metric}
            label={label}
            overview={financialMetricOverview(financialFacts, metric)}
            onOpenSource={onOpenSource}
          />
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  overview,
  onOpenSource,
}: {
  label: string;
  overview: ReturnType<typeof financialMetricOverview>;
  onOpenSource: SourceAction;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const id = useId();
  const { latest, state, series } = overview;
  const selected = series.find((item) => item.key === selectedKey) ?? series[0];
  return (
    <Card className="min-w-0 gap-0 py-0">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          aria-label={`${label} period history`}
          className="group/metric w-full rounded-xl p-5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/40 sm:p-6"
        >
          <span className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-sm font-medium text-muted-foreground">{label}</span>
            <Badge variant={stateVariants[state]}>{stateLabels[state]}</Badge>
          </span>
          <span
            className={cn(
              "mt-3 block text-[1.75rem] leading-tight font-semibold tracking-tight break-words tabular-nums",
              !latest && "text-muted-foreground",
            )}
          >
            {latest ? formatFinancialMoney(latest.value) : "Not available"}
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {latest ? `${financialPeriodLabel(latest.period)} · USD` : "No reviewed period"}
          </span>
          {latest && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {latest.businessSnapshot.businessName}
            </span>
          )}
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-info">
            {expanded ? "Hide period history" : "View period history"}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            />
          </span>
        </CollapsibleTrigger>
        {state !== "current" && (
          <p className="flex gap-2 border-t px-5 py-3 text-sm text-muted-foreground sm:px-6">
            <FileSearch aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state === "stale"
              ? "The last accepted value is retained. Its source changed and needs lender review."
              : state === "unconfirmed"
                ? "Document suggestions have not been accepted. No suggestion is used as a financial value."
                : `No reviewed ${label.toLowerCase()} or source suggestion is available.`}
          </p>
        )}
        <CollapsibleContent id={`${id}-history`}>
          <div className="border-t px-5 py-5 sm:px-6">
            <section aria-label={`${label} period history details`} className="space-y-4">
              <h3 className="font-semibold">{label} period history</h3>
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  No reviewed periods to chart. Not comparable until matching periods are reviewed.
                </p>
              ) : (
                <>
                  {series.length > 1 && (
                    <div className="space-y-2">
                      <label htmlFor={`${id}-series`} className="block text-sm font-medium">
                        {label} period series
                      </label>
                      <NativeSelect
                        id={`${id}-series`}
                        className="w-full"
                        value={selected.key}
                        onChange={(event) => setSelectedKey(event.target.value)}
                      >
                        {series.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.facts[0]?.businessSnapshot.businessName} ·{" "}
                            {item.facts[0]?.period.basis === "fiscal_year"
                              ? "Fiscal periods"
                              : "Statements"}{" "}
                            · {item.facts[0]?.period.start} – {item.facts[0]?.period.end}
                          </option>
                        ))}
                      </NativeSelect>
                      <p className="text-xs text-muted-foreground">
                        Different businesses, period lengths and bases are shown separately.
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {selected.facts[0]?.businessSnapshot.businessName} · USD ·{" "}
                    {selected.facts[0]?.period.basis === "fiscal_year"
                      ? "Fiscal-year basis"
                      : "Statement basis"}
                  </p>
                  {selected.facts.filter((fact) => !fact.sourceStale).length < 2 && (
                    <p className="text-sm text-muted-foreground">
                      Not comparable: at least two current reviewed periods on the same basis are
                      needed for a period comparison.
                    </p>
                  )}
                  <FinancialHistoryChart facts={selected.facts} label={label} />
                  <div className="max-w-full overflow-x-auto rounded-lg border">
                    <table
                      aria-label={`${label} period history`}
                      className="w-full text-left text-sm"
                    >
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="p-3 font-medium">
                            Fiscal period
                          </th>
                          <th scope="col" className="p-3 font-medium">
                            Reviewed value
                          </th>
                          <th scope="col" className="p-3 font-medium">
                            Source status
                          </th>
                          <th scope="col" className="p-3 font-medium">
                            Evidence
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.facts.map((fact) => (
                          <tr
                            key={`${selected.key}:${fact.period.start}:${fact.period.end}`}
                            className="border-t align-top"
                          >
                            <th scope="row" className="p-3 font-normal">
                              {financialPeriodLabel(fact.period)}
                              <span className="block text-xs text-muted-foreground">
                                {fact.period.start} – {fact.period.end}
                              </span>
                            </th>
                            <td className="p-3 tabular-nums">{formatFinancialMoney(fact.value)}</td>
                            <td className="p-3">
                              {fact.sourceStale ? "Stale source" : "Current reviewed value"}
                              <span className="block text-xs text-muted-foreground">
                                {fact.disposition === "correct" ? "Corrected" : "Accepted"} ·
                                Revision {fact.factRevision}
                              </span>
                            </td>
                            <td className="p-3">
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`Open ${label} source for ${financialPeriodLabel(fact.period)}, version ${fact.source.versionId}`}
                                onClick={() =>
                                  onOpenSource(
                                    fact.source.documentId,
                                    fact.source.versionId,
                                    fact.source.runId,
                                  )
                                }
                              >
                                Source · Page {fact.source.sourcePage}
                              </Button>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {fact.source.sourceLabel}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only available reviewed periods are shown. Stale values are retained historical
                    acceptances. The table gives exact values and the corresponding source version.
                  </p>
                </>
              )}
            </section>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function FinancialHistoryChart({ facts, label }: { facts: FinancialFact[]; label: string }) {
  const { zero, bars } = financialChartBars(facts);
  const left = 110;
  const width = 330;
  const height = bars.length * 46 + 34;
  return (
    <svg
      role="img"
      aria-label={`${label} period history chart`}
      viewBox={`0 0 550 ${height}`}
      className="w-full rounded-lg border bg-muted/20 text-foreground"
    >
      <title>{label} period history chart</title>
      <desc>
        Reviewed USD values. The table below contains equivalent exact values and source states.
      </desc>
      <line
        x1={left + (width * zero) / 100}
        x2={left + (width * zero) / 100}
        y1="10"
        y2={height - 20}
        className="stroke-border"
      />
      {bars.map(({ fact, from, width: barWidth }, index) => (
        <g key={fact.id}>
          <title>
            {financialPeriodLabel(fact.period)}: {formatFinancialMoney(fact.value)};{" "}
            {fact.sourceStale ? "Stale source" : "Current reviewed value"}
          </title>
          <text
            x="14"
            y={index * 46 + 30}
            className="fill-muted-foreground text-[12px] font-medium"
          >
            {fact.period.end}
          </text>
          <rect
            x={left + (width * from) / 100}
            y={index * 46 + 14}
            width={Math.max(2, (width * barWidth) / 100)}
            height="24"
            rx="5"
            className={fact.sourceStale ? "fill-muted-foreground/50" : "fill-chart-1"}
          />
          <text
            x={left + (width * (from + barWidth)) / 100 + 8}
            y={index * 46 + 30}
            className="fill-current text-[12px] font-semibold tabular-nums"
          >
            {formatFinancialMoney(fact.value)}
          </text>
          {fact.sourceStale && (
            <text x="14" y={index * 46 + 44} className="fill-warning text-[10px]">
              Stale source
            </text>
          )}
        </g>
      ))}
      <text
        x={left + (width * zero) / 100}
        y={height - 5}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        $0
      </text>
    </svg>
  );
}
