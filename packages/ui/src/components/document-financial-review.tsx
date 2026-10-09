import {
  type FinancialCandidate,
  type FinancialFactsView,
  type ReviewFinancialFacts,
  reviewFinancialFactsSchema,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { Textarea } from "@keycade/ui/components/textarea";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

type Selection = {
  candidate: FinancialCandidate;
  disposition: "accept" | "correct" | "reject";
  value: string;
  replace: boolean;
};
export function documentMoney(value: string, currency = "USD") {
  const [whole, fraction] = value.split(".");
  return `${currency} ${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function DocumentFinancialReview({
  data,
  documentId,
  versionId,
  runId,
  review,
  reload,
  sourcePage,
  errorMessage,
}: {
  data: FinancialFactsView;
  documentId: string;
  versionId: string;
  runId: string;
  review: (input: ReviewFinancialFacts) => Promise<unknown>;
  reload: () => Promise<unknown>;
  sourcePage: (page: number) => void;
  errorMessage: (error: unknown) => string;
}) {
  const candidates = data.candidates.filter(
    (candidate) =>
      candidate.source.documentId === documentId &&
      candidate.source.versionId === versionId &&
      candidate.source.runId === runId,
  );
  const history = data.history
    .filter(
      (entry) => entry.source.documentId === documentId && entry.source.versionId === versionId,
    )
    .toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt));
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [applicationRevision, setApplicationRevision] = useState(data.applicationRevision);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const values = Object.values(selected);
  const allowed =
    data.canReview &&
    values.every((entry) =>
      candidates.some(
        (candidate) => candidate.fieldKey === entry.candidate.fieldKey && candidate.canReview,
      ),
    );
  const requiresReplacement = (entry: Selection) =>
    entry.disposition !== "reject" &&
    entry.candidate.currentFactValue !== null &&
    entry.candidate.currentFactValue !==
      (entry.disposition === "correct" ? entry.value : entry.candidate.value);
  const replacementConfirmed = values.every(
    (entry) => !requiresReplacement(entry) || entry.replace,
  );
  const update = (key: string, changes: Partial<Selection>) =>
    setSelected((current) =>
      current[key] ? { ...current, [key]: { ...current[key], ...changes } } : current,
    );
  async function apply(event: FormEvent) {
    event.preventDefault();
    if (!values.length || !allowed || !replacementConfirmed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const source = values[0]?.candidate.source;
      if (!source) return;
      const payload = {
        expectedApplicationRevision: applicationRevision,
        documentId,
        versionId,
        runId,
        expectedRunGeneration: source.runGeneration,
        expectedCategoryRevision: source.categoryRevision,
        expectedAnalysisRevision: source.analysisRevision,
        decisions: values.map((entry) => ({
          fieldKey: entry.candidate.fieldKey,
          disposition: entry.disposition,
          expectedFactRevision: entry.candidate.currentFactRevision,
          ...(entry.disposition === "correct" ? { value: entry.value } : {}),
          reason: reason.trim(),
        })),
      };
      const fingerprint = JSON.stringify(payload);
      if (command.current?.fingerprint !== fingerprint)
        command.current = { fingerprint, key: crypto.randomUUID() };
      const parsed = reviewFinancialFactsSchema.safeParse({
        ...payload,
        idempotencyKey: command.current.key,
      });
      if (!parsed.success) {
        setError(
          "Enter each correction as an exact decimal with two places (for example 210000.00), and provide a reason.",
        );
        return;
      }
      await review(parsed.data);
      await reload();
      setSelected({});
      setReason("");
      command.current = null;
      setNotice(
        "Selected financial reviews saved together. Accepted values now belong to this application; rejected suggestions remain in history.",
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Reviewed financial facts" className="space-y-4 border-t pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Reviewed financial facts</h3>
        <Badge variant="outline">Document source</Badge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Select suggestions to explicitly accept, reject or correct. Deposits, ordinary income and
        adjusted net income remain separate metrics. This does not accept task evidence or make a
        credit decision.
      </p>
      {!data.canReview && (
        <p className="rounded-lg border p-3 text-sm">
          Financial inputs are locked at this application stage. Use the existing
          return-for-information workflow before changing decision inputs.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Financial review was not completed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            <p>
              A conflicting revision changes no selected values. Reload the latest values and review
              your selection again. If the response was interrupted, retrying an unchanged selection
              is safe.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setSelected({});
                setReason("");
                setError(null);
                command.current = null;
                await reload().catch((failure) => setError(errorMessage(failure)));
              }}
            >
              Reload latest financial values
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!candidates.length ? (
        <p className="text-sm text-muted-foreground">
          No eligible financial suggestions are available for this exact document version and
          analysis run. Original extracted values and prior reviews remain visible.
        </p>
      ) : (
        <form onSubmit={(event) => void apply(event)} className="space-y-4">
          <fieldset disabled={busy} className="space-y-3">
            <legend className="sr-only">Select financial suggestions</legend>
            {candidates.map((live) => {
              const selection = selected[live.fieldKey];
              const candidate = selection?.candidate ?? live;
              const lastReview = history.find(
                (entry) => entry.source.runId === runId && entry.fieldKey === candidate.fieldKey,
              );
              return (
                <div key={candidate.fieldKey} className="space-y-3 rounded-lg border p-3 text-sm">
                  <label className="flex items-start gap-2 font-medium">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-info"
                      checked={Boolean(selection)}
                      disabled={!data.canReview || !live.canReview}
                      onChange={(event) => {
                        setNotice(null);
                        if (event.target.checked) {
                          if (!values.length) setApplicationRevision(data.applicationRevision);
                          setSelected((current) => ({
                            ...current,
                            [candidate.fieldKey]: {
                              candidate: live,
                              disposition: "accept",
                              value: live.value,
                              replace: false,
                            },
                          }));
                        } else
                          setSelected((current) => {
                            const next = { ...current };
                            delete next[candidate.fieldKey];
                            return next;
                          });
                      }}
                    />
                    Select {workflowText(candidate.label)}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {candidate.period.start} to {candidate.period.end} ·{" "}
                    {candidate.period.basis.replaceAll("_", " ")} · {candidate.currency}
                  </p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Current accepted value</dt>
                      <dd>
                        {candidate.currentFactValue === null
                          ? "Not available"
                          : documentMoney(candidate.currentFactValue)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Original suggestion</dt>
                      <dd className="font-medium">{documentMoney(candidate.value)}</dd>
                    </div>
                  </dl>
                  <Button
                    type="button"
                    size="sm"
                    variant="link"
                    className="h-auto max-w-full whitespace-normal p-0 text-left"
                    onClick={() => sourcePage(candidate.source.sourcePage)}
                  >
                    Page {candidate.source.sourcePage} · {candidate.source.sourceLabel}
                  </Button>
                  <p className="text-xs">
                    Review status:{" "}
                    {lastReview
                      ? lastReview.disposition === "reject"
                        ? "Rejected"
                        : lastReview.disposition === "correct"
                          ? "Corrected and accepted"
                          : "Accepted"
                      : "Pending"}
                  </p>
                  {!live.canReview && (
                    <p className="text-xs text-muted-foreground">
                      {live.unavailableReason ??
                        "This source needs review before it can be applied."}
                    </p>
                  )}
                  {selection && (
                    <div className="space-y-3 border-t pt-3">
                      <label className="block space-y-1">
                        Review action for {workflowText(candidate.label)}
                        <NativeSelect
                          value={selection.disposition}
                          onChange={(event) =>
                            update(candidate.fieldKey, {
                              disposition: event.target.value as Selection["disposition"],
                              replace: false,
                            })
                          }
                        >
                          <option value="accept">Accept suggestion</option>
                          <option value="correct">Correct and accept</option>
                          <option value="reject">Reject suggestion</option>
                        </NativeSelect>
                      </label>
                      {selection.disposition === "correct" && (
                        <label className="block space-y-1">
                          Corrected value for {workflowText(candidate.label)}
                          <Input
                            inputMode="decimal"
                            value={selection.value}
                            required
                            onChange={(event) =>
                              update(candidate.fieldKey, {
                                value: event.target.value,
                                replace: false,
                              })
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            Exact USD amount with two decimal places. The original suggestion and
                            period are preserved.
                          </span>
                        </label>
                      )}
                      <p>
                        Proposed outcome:{" "}
                        {selection.disposition === "reject"
                          ? "Reject this suggestion; retain the current accepted value."
                          : documentMoney(
                              selection.disposition === "correct"
                                ? selection.value
                                : candidate.value,
                            )}
                      </p>
                      {requiresReplacement(selection) && (
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-info"
                            checked={selection.replace}
                            onChange={(event) =>
                              update(candidate.fieldKey, { replace: event.target.checked })
                            }
                          />
                          Replace the accepted value for {workflowText(candidate.label)}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
          {values.length > 0 && (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                Reason for financial review
                <Textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                All {values.length} selected field reviews are saved atomically against application
                revision {applicationRevision}. Review the current and proposed values before
                applying.
              </p>
              <Button
                loading={busy}
                type="submit"
                disabled={busy || !allowed || !replacementConfirmed || !reason.trim()}
              >
                Apply selected values
              </Button>
            </div>
          )}
        </form>
      )}
      {history.length > 0 && (
        <Collapsible className="rounded-lg border p-3">
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
            />
            Financial review history ({history.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-3 space-y-3 text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="space-y-1 border-l-2 pl-3">
                  <p className="font-medium">
                    {workflowText(entry.label)} ·{" "}
                    {entry.disposition === "reject"
                      ? "Rejected"
                      : entry.disposition === "correct"
                        ? "Corrected and accepted"
                        : "Accepted"}{" "}
                    · {documentMoney(entry.value)}
                  </p>
                  <p>
                    {entry.period.start} to {entry.period.end} · run {entry.source.runGeneration}
                  </p>
                  {entry.disposition === "correct" && (
                    <p>Original suggestion: {documentMoney(entry.originalCandidate.value)}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{entry.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Reviewed {new Date(entry.reviewedAt).toLocaleString()} · Staff{" "}
                    {entry.reviewerUserId}
                  </p>
                  {data.facts.find((fact) => fact.id === entry.id)?.sourceStale && (
                    <Badge variant="outline">Stale source — review required</Badge>
                  )}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
