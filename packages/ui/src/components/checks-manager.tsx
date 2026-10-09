import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

type Stage = "submission" | "approval" | "closing";
const stageLabels: Record<Stage, string> = {
  submission: "Submission",
  approval: "Approval",
  closing: "Closing",
};
type Outcome = "clear" | "needs_review" | "unable_to_verify";
type Status =
  | "waiting_for_input"
  | "queued"
  | "running"
  | "succeeded"
  | "retry_scheduled"
  | "failed"
  | "timed_out"
  | "cancelled";
const outcomeLabels: Record<Outcome, string> = {
  clear: "Simulated clear",
  needs_review: "Needs staff review",
  unable_to_verify: "Unable to verify",
};
const statusLabels: Record<Status, string> = {
  waiting_for_input: "Waiting for prerequisites",
  queued: "Queued",
  running: "Running",
  succeeded: "Finished",
  retry_scheduled: "Retry scheduled",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
};
const prerequisiteLabels = {
  business_address: "A complete business address is needed for the simulated country check.",
  identifier: "A synthetic identifier is needed.",
  owner_access: "The owner needs current portal access.",
  reviewed_documents: "Current document evidence needs bank review.",
};
const blockerReasons: Record<string, string> = {
  initial_setup_incomplete: "Finish initial setup.",
  initial_fields_invalid: "Review the business and requested loan details.",
  verified_applicant_authority_required: "A verified applicant with full access is required.",
  signature_evidence_not_current: "Current evidence needs a completed signature request.",
  current_document_not_ready: "Current documents must finish upload and simulated scan.",
  current_evidence_not_reviewed: "The bank must review the current evidence.",
  awaiting_lender_review: "Completed by the client. Mark it reviewed before approval.",
  requirement_unfinished: "Complete this required task.",
  required_check_missing: "Required checks have not been initialized.",
  check_needs_review: "The simulated finding needs a permitted staff resolution.",
  check_unable_to_verify: "The simulated check could not verify its inputs.",
  check_waiting_for_input: "Required inputs are missing.",
  check_queued: "The simulated check is queued.",
  check_running: "The simulated check is running.",
  check_retry_scheduled: "A simulated retry is scheduled.",
  check_failed: "The simulated check failed and needs attention.",
  check_timed_out: "The simulated check timed out.",
  check_cancelled: "The current check was cancelled.",
  check_stale_or_missing: "A current simulated result is needed.",
  check_unknown: "The simulated result is unknown.",
  lifecycle_not_ready: "The application has not entered the required stage.",
};
type CheckRun = {
  id: string;
  status: Status;
  stale: boolean;
  outcome: Outcome | null;
  missingPrerequisites: (keyof typeof prerequisiteLabels)[];
  evidence: { findings: string[] } | null;
  resolved: boolean;
  resolution: { createdAt: string } | null;
  updatedAt: string;
};
export type ChecksData = {
  canManage: boolean;
  checks: {
    id: string;
    title: string;
    stage: Stage;
    required: boolean;
    currentRunId: string | null;
    passes: boolean;
    canRetry: boolean;
    canResolve: boolean;
    runs: CheckRun[];
  }[];
};
export type ReadinessData = {
  scope: "application" | "assigned";
  gates: {
    stage: Stage;
    ready: boolean;
    blockers: { kind: string; id: string | null; stage: Stage; title: string; reason: string }[];
  }[];
};
export function ReadinessPanel({
  data,
  compact = false,
}: {
  data: ReadinessData;
  compact?: boolean;
}) {
  const currentStage =
    data.gates.find((gate) => !gate.blockers.some((blocker) => blocker.kind === "lifecycle"))
      ?.stage ?? "submission";
  return (
    <Card className="ring-0 shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2>{data.scope === "assigned" ? "Your requirements" : "Application readiness"}</h2>
        </CardTitle>
        <CardDescription>
          {data.scope === "assigned"
            ? "Only your permitted work appears here. The bank may have additional application requirements."
            : "Required current evidence and checks, evaluated for each stage."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.gates.map((gate) => (
          <section
            key={gate.stage}
            aria-label={`${stageLabels[gate.stage]} readiness`}
            className="space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{stageLabels[gate.stage]}</h3>
              <Badge variant={gate.ready ? "secondary" : "outline"}>
                {gate.ready
                  ? data.scope === "assigned"
                    ? "Visible work satisfied"
                    : "Requirements satisfied"
                  : `${gate.blockers.length} ${gate.blockers.length === 1 ? "blocker" : "blockers"}`}
              </Badge>
            </div>
            {gate.blockers.length > 0 && (
              <Collapsible defaultOpen={!compact && gate.stage === currentStage}>
                <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground w-full text-left">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
                  />
                  View next actions
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Blockers blockers={gate.blockers} />
                </CollapsibleContent>
              </Collapsible>
            )}
          </section>
        ))}
        <p className="text-xs leading-5 text-muted-foreground">
          Simulated readiness · Each stage includes earlier required work. Later-stage checks do not
          block earlier stages. These results do not approve or decline the application.
        </p>
      </CardContent>
    </Card>
  );
}
function Blockers({ blockers }: { blockers: ReadinessData["gates"][number]["blockers"] }) {
  return (
    <ul className="mt-2 space-y-3 text-sm">
      {blockers.map((blocker, index) => (
        <li key={`${blocker.kind}-${blocker.id}-${index}`} className="space-y-1">
          <p className="font-medium">{blocker.title}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {blockerReasons[blocker.reason] ?? "This requirement needs attention."} ·{" "}
            {stageLabels[blocker.stage]}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ChecksManager({
  data,
  retry,
  resolve,
  errorMessage,
}: {
  data: ChecksData;
  retry: (
    checkId: string,
    runId: string,
    reason: "operator_review" | "provider_unavailable" | "timeout",
  ) => Promise<unknown>;
  resolve: (checkId: string, runId: string) => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  return (
    <Card className="ring-0 shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2>Simulated checks</h2>
        </CardTitle>
        <CardDescription>
          Current identity and fraud checks use fictional inputs. Bank decisions remain separate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {data.checks.length ? (
          data.checks.map((check) => (
            <Check
              key={check.id}
              check={check}
              canManage={data.canManage}
              retry={(runId, reason) => retry(check.id, runId, reason)}
              resolve={(runId) => resolve(check.id, runId)}
              errorMessage={errorMessage}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No checks are visible for your account.</p>
        )}
      </CardContent>
    </Card>
  );
}
function Check({
  check,
  canManage,
  retry,
  resolve,
  errorMessage,
}: {
  check: ChecksData["checks"][number];
  canManage: boolean;
  retry: (
    runId: string,
    reason: "operator_review" | "provider_unavailable" | "timeout",
  ) => Promise<unknown>;
  resolve: (runId: string) => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  const [reason, setReason] = useState<"operator_review" | "provider_unavailable" | "timeout">(
    "operator_review",
  );
  const [reviewedRun, setReviewedRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = check.runs.find((run) => run.id === check.currentRunId);
  async function act(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      setReviewedRun(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function result(run: CheckRun) {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">{statusLabels[run.status]}</span>
          {run.stale && <Badge variant="secondary">Outdated input</Badge>}
          {run.outcome && (
            <Badge variant={run.outcome === "clear" ? "secondary" : "outline"}>
              {outcomeLabels[run.outcome]}
            </Badge>
          )}
          {run.resolved && <Badge variant="secondary">Staff resolution recorded</Badge>}
        </div>
        {run.missingPrerequisites.length > 0 && (
          <ul className="space-y-1 text-muted-foreground">
            {run.missingPrerequisites.map((key) => (
              <li key={key}>{prerequisiteLabels[key]}</li>
            ))}
          </ul>
        )}
        {run.stale && (
          <p className="text-muted-foreground">
            Inputs changed after this run. An outdated result cannot satisfy readiness.
          </p>
        )}
        {canManage && run.evidence && (
          <p className="text-xs text-muted-foreground">
            Staff evidence:{" "}
            {run.evidence.findings
              .map(
                (finding) =>
                  ({
                    synthetic_match: "synthetic match",
                    synthetic_review_flag: "synthetic review flag",
                    synthetic_no_match: "no synthetic match",
                  })[finding] ?? "synthetic finding",
              )
              .join("; ")}
            .
          </p>
        )}
        {run.resolution && (
          <p className="text-xs text-muted-foreground">
            Staff reviewed synthetic evidence on{" "}
            {new Date(run.resolution.createdAt).toLocaleString()}. The original finding is
            preserved.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Updated {new Date(run.updatedAt).toLocaleString()}
        </p>
      </div>
    );
  }
  return (
    <section aria-label={check.title} className="space-y-4 py-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold tracking-tight">{check.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {stageLabels[check.stage]} · {check.required ? "Required" : "Optional"}
          </p>
        </div>
        <Badge variant={check.passes ? "secondary" : "outline"}>
          {check.passes ? "Requirement satisfied" : "Not satisfied"}
        </Badge>
      </div>
      {current ? (
        result(current)
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the first current run.</p>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Check action incomplete</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {canManage && current && check.canRetry && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`retry-reason-${check.id}`} className="text-xs">
              Retry reason
            </label>
            <NativeSelect
              id={`retry-reason-${check.id}`}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value as typeof reason)}
            >
              <option value="operator_review">Staff review</option>
              <option value="provider_unavailable">Provider unavailable</option>
              <option value="timeout">Previous timeout</option>
            </NativeSelect>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(() => retry(current.id, reason), "Check retry requested.")}
          >
            Retry check
          </Button>
        </div>
      )}
      {canManage && current && check.canResolve && (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={reviewedRun === current.id}
              disabled={busy}
              onChange={(event) => setReviewedRun(event.target.checked ? current.id : null)}
            />
            I reviewed the synthetic evidence for this result.
          </label>
          <Button
            size="sm"
            disabled={busy || reviewedRun !== current.id}
            onClick={() =>
              void act(
                () => resolve(current.id),
                "Staff resolution recorded. The original simulated outcome remains visible.",
              )
            }
          >
            Record staff resolution
          </Button>
        </div>
      )}
      {check.runs.length > 1 && (
        <Collapsible>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
            />
            Check history ({check.runs.length - 1})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-4">
              {check.runs
                .filter((run) => run.id !== current?.id)
                .map((run) => (
                  <div key={run.id}>{result(run)}</div>
                ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
