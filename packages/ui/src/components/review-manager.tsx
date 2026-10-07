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
import { type ReadinessData, ReadinessPanel } from "@keycade/ui/components/checks-manager";
import {
  type ReviewAction,
  ReviewActionForm,
  type ReviewActionInput,
} from "@keycade/ui/components/review-action-form";
import { useEffect, useRef, useState } from "react";

type Status =
  | "draft"
  | "collecting_information"
  | "needs_information"
  | "submitted"
  | "in_review"
  | "approved"
  | "declined"
  | "closing"
  | "funded"
  | "withdrawn";
const statusLabels: Record<Status, string> = {
  draft: "Draft",
  collecting_information: "Collecting information",
  needs_information: "More information requested",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  declined: "Declined",
  closing: "Closing",
  funded: "Funding recorded",
  withdrawn: "Withdrawn",
};
const statusDescriptions: Record<Status, string> = {
  draft:
    "Complete initial setup before submitting. You can withdraw this draft if you no longer wish to continue.",
  collecting_information:
    "Complete the submission requirements, then explicitly submit this application for bank review.",
  needs_information:
    "The bank requested an update. Complete the returned tasks and submit a new version when ready.",
  submitted:
    "This submission is waiting for bank review. Material application information is locked.",
  in_review:
    "The bank is reviewing the current submission. A staff member must deliberately record the next step.",
  approved:
    "The bank recorded a simulated approval. Closing requirements and recorded funding are separate steps.",
  declined:
    "The bank recorded a simulated decline. This application is closed; its history remains available.",
  closing:
    "This application is completing its closing requirements. Approval alone does not record funding.",
  funded: "Simulated funding was recorded. This review history remains available.",
  withdrawn:
    "This application was withdrawn. Pending work that no longer applies is cancelled, and saved history remains available.",
};
const actionLabels: Record<ReviewAction, string> = {
  submit: "Submit application",
  "start-review": "Start bank review",
  "request-information": "Request information",
  approve: "Approve application",
  decline: "Decline application",
  withdraw: "Withdraw application",
};
const historyLabels: Record<string, string> = {
  submit: "Application submitted",
  start_review: "Bank review started",
  request_information: "Information requested",
  approve: "Approval recorded",
  decline: "Decline recorded",
  withdraw: "Application withdrawn",
};
type Facts = {
  businessName: string | null;
  productName: string;
  industryCode: string | null;
  industryTaxonomyVersion: string | null;
  requestedAmount: string | null;
  purpose: string | null;
};
export type ReviewData = {
  applicationId: string;
  revision: number;
  status: Status;
  canManage: boolean;
  capabilities: {
    submit: boolean;
    startReview: boolean;
    requestInformation: boolean;
    approve: boolean;
    decline: boolean;
    withdraw: boolean;
  };
  decisions: { outcome: "approved" | "declined"; approvedAmount: string | null }[];
  readiness: ReadinessData;
  requestableTasks: { id: string; title: string }[];
  submissions: {
    id: string;
    sequence: number;
    createdAt: string;
    submittedOnBehalf: boolean;
    facts: Facts | null;
  }[];
  history: {
    id: string;
    action: string;
    createdAt: string;
    reasonCode: string | null;
    privateNote: string | null;
    publicReason: string | null;
  }[];
};
export type ReviewReasons = Partial<Record<ReviewAction, { value: string; label: string }[]>>;
function amount(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value),
  );
}
function date(value: string) {
  return new Date(value).toLocaleString();
}
export function ReviewManager({
  data,
  reasons,
  taskHref,
  checkHref,
  mutate,
  reload,
  errorMessage,
}: {
  data: ReviewData;
  reasons: ReviewReasons;
  taskHref: string;
  checkHref?: string;
  mutate: (
    action: ReviewAction,
    input: ReviewActionInput,
    expectedRevision: number,
    idempotencyKey: string,
  ) => Promise<ReviewData>;
  reload: () => Promise<ReviewData>;
  errorMessage: (error: unknown) => string;
}) {
  const [snapshot, setSnapshot] = useState(data);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [action, setAction] = useState<Exclude<ReviewAction, "start-review"> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const stale = conflict || (!busy && data.revision > snapshot.revision);
  useEffect(() => {
    if (!action && !dirty && !busy && !conflict && data.revision >= snapshot.revision)
      setSnapshot(data);
  }, [data, snapshot.revision, dirty, busy, conflict, action]);
  function reset() {
    attempt.current = null;
    setAction(null);
    setDirty(false);
    setConflict(false);
    setError(null);
    setFormRevision((value) => value + 1);
  }
  async function perform(next: ReviewAction, input: ReviewActionInput) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const signature = JSON.stringify([next, input, snapshot.revision]);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const updated = await mutate(next, input, snapshot.revision, attempt.current.key);
      setSnapshot(updated);
      reset();
      setNotice(
        next === "submit"
          ? "Application submitted. This version is saved for bank review."
          : next === "start-review"
            ? "Bank review started."
            : next === "request-information"
              ? "The application was returned for information. Previous submissions remain available."
              : next === "approve"
                ? "Simulated approval recorded. Funding has not been recorded."
                : next === "decline"
                  ? "Simulated decline recorded."
                  : "Application withdrawn.",
      );
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        failure &&
        typeof failure === "object" &&
        "code" in failure &&
        failure.code === "REVISION_CONFLICT"
      )
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await reload());
      reset();
      setNotice(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const actions = (
    Object.entries({
      submit: snapshot.capabilities.submit,
      "start-review": snapshot.capabilities.startReview,
      "request-information": snapshot.capabilities.requestInformation,
      approve: snapshot.capabilities.approve,
      decline: snapshot.capabilities.decline,
      withdraw: snapshot.capabilities.withdraw,
    }) as [ReviewAction, boolean][]
  )
    .filter(([, enabled]) => enabled)
    .map(([action]) => action);
  const approvedAmount = snapshot.decisions.find(
    (decision) => decision.outcome === "approved",
  )?.approvedAmount;
  const reasonLabel = (code: string) =>
    Object.values(reasons)
      .flat()
      .find((reason) => reason.value === code)?.label ?? "A reason was recorded for this action.";
  const closed = ["declined", "withdrawn", "funded"].includes(snapshot.status);
  const nextStage = ["approved", "closing"].includes(snapshot.status)
    ? "closing"
    : ["submitted", "in_review"].includes(snapshot.status)
      ? "approval"
      : "submission";
  const stages = ["submission", "approval", "closing"];
  const readiness = {
    ...snapshot.readiness,
    gates: snapshot.readiness.gates.filter(
      (gate) => stages.indexOf(gate.stage) >= stages.indexOf(nextStage),
    ),
  };
  return (
    <div
      className={`grid items-start gap-6 ${closed ? "" : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"}`}
    >
      <div className="space-y-6">
        <Card className="ring-0 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                <h2>Application review</h2>
              </CardTitle>
              <Badge variant="secondary">{statusLabels[snapshot.status]}</Badge>
            </div>
            <CardDescription>{statusDescriptions[snapshot.status]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {approvedAmount && (
              <div>
                <p className="text-sm text-muted-foreground">Approved amount</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {amount(approvedAmount)}
                </p>
              </div>
            )}
            {(error || stale) && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>
                  {stale ? "This application changed" : "The action could not be recorded"}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {error ??
                      "A newer revision is available. Your entered reason and terms have been preserved."}
                  </p>
                  {stale && (
                    <>
                      <p>
                        Reload the current application before retrying. Reloading replaces unsaved
                        entries.
                      </p>
                      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                        Reload current application
                      </Button>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            {action ? (
              <ReviewActionForm
                key={`${action}:${formRevision}`}
                action={action}
                canManage={snapshot.canManage}
                requestedAmount={snapshot.submissions[0]?.facts?.requestedAmount ?? null}
                reasonOptions={reasons[action] ?? []}
                requestableTasks={snapshot.requestableTasks}
                busy={busy}
                stale={stale}
                onDirtyChange={setDirty}
                save={(input) => perform(action, input)}
                cancel={reset}
              />
            ) : actions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {actions.map((next) => (
                  <Button
                    key={next}
                    disabled={busy || stale}
                    variant={next === "submit" || next === "start-review" ? "default" : "outline"}
                    onClick={() => {
                      setNotice(null);
                      setError(null);
                      if (next === "start-review") void perform(next, { confirmed: true });
                      else setAction(next);
                    }}
                  >
                    {next === "submit" && snapshot.status === "needs_information"
                      ? "Resubmit application"
                      : actionLabels[next]}
                  </Button>
                ))}
              </div>
            ) : null}
            {!closed && snapshot.status !== "draft" && (
              <div className="flex flex-wrap gap-4 text-sm">
                <a href={taskHref} className="underline underline-offset-4">
                  View tasks
                </a>
                {checkHref && (
                  <a href={checkHref} className="underline underline-offset-4">
                    Review simulated checks
                  </a>
                )}
              </div>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              Simulated review · Checks and document suggestions never approve or decline an
              application automatically.
            </p>
          </CardContent>
        </Card>
        <Card className="ring-0 shadow-sm">
          <CardHeader>
            <CardTitle>
              <h2>Submission history</h2>
            </CardTitle>
            <CardDescription>
              Each submission retains the application facts and evidence references recorded at that
              time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {snapshot.submissions.length ? (
              snapshot.submissions.map((submission) => (
                <details key={submission.id} className="space-y-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Submission {submission.sequence} · {date(submission.createdAt)}
                  </summary>
                  <p className="text-xs text-muted-foreground">
                    {submission.submittedOnBehalf
                      ? "Submitted by bank staff on behalf of the applicant."
                      : "Submitted by the applicant."}
                  </p>
                  {submission.facts && (
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Business</dt>
                        <dd className="mt-1 break-words">
                          {submission.facts.businessName ?? "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Requested amount</dt>
                        <dd className="mt-1">
                          {submission.facts.requestedAmount
                            ? amount(submission.facts.requestedAmount)
                            : "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Product</dt>
                        <dd className="mt-1 break-words">{submission.facts.productName}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Industry</dt>
                        <dd className="mt-1 break-words">
                          {submission.facts.industryCode
                            ? `${submission.facts.industryCode} · ${submission.facts.industryTaxonomyVersion}`
                            : "Not provided"}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Purpose</dt>
                        <dd className="mt-1 break-words">
                          {submission.facts.purpose ?? "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </details>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No application has been submitted for review yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="ring-0 shadow-sm">
          <CardHeader>
            <CardTitle>
              <h2>Review history</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-6">
              {snapshot.history.length ? (
                snapshot.history.map((event) => (
                  <li key={event.id} className="space-y-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-medium">
                        {historyLabels[event.action] ?? "Application updated"}
                      </h3>
                      <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>
                        {date(event.createdAt)}
                      </time>
                    </div>
                    {(event.publicReason || event.reasonCode) && (
                      <p>{event.publicReason ?? reasonLabel(event.reasonCode ?? "")}</p>
                    )}
                    {event.action === "approve" && approvedAmount && (
                      <p>Approved amount: {amount(approvedAmount)}</p>
                    )}
                    {snapshot.canManage && event.privateNote && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Private staff note</p>
                        <p className="whitespace-pre-wrap break-words">{event.privateNote}</p>
                      </div>
                    )}
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-foreground">
                  No review actions have been recorded.
                </li>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>
      {!closed && <ReadinessPanel data={readiness} />}
    </div>
  );
}
