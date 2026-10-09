import {
  activityViewSchema,
  checksViewSchema,
  fundingPurposeOptions,
  industryByCode,
  type StaffOverview,
  type StaffWorkspace,
  staffOverviewSchema,
  tasksViewSchema,
} from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { DescriptionItem, DescriptionList } from "@keycade/ui/components/description-list";
import { checkRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { cn } from "@keycade/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  FileText,
  History,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link } from "react-router";
import { formatAmount, useStaffApi } from "./api";
import { useApplicationDocuments } from "./documents";
import { FinancialOverview } from "./financial-overview";
import { LoanFootprintItem } from "./loan-footprint";
import { ApplicationTasks } from "./tasks";
import { ErrorNotice, Loading, statusLabels } from "./ui";

export function ApplicationOverview({
  workspace,
  navigationQuery,
  aside,
}: {
  workspace: StaffWorkspace;
  navigationQuery: string;
  aside?: ReactNode;
}) {
  const api = useStaffApi();
  const client = useQueryClient();
  const base = `/applications/${workspace.id}`;
  const documents = useApplicationDocuments({ applicationId: workspace.id, lazy: true });
  const overview = useQuery({
    queryKey: ["staff-overview", workspace.id],
    queryFn: ({ signal }) =>
      api.participantRequest(`${base}/overview`, staffOverviewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.error ? false : 15_000),
  });
  useEffect(() => {
    if (overview.data && overview.data.applicationRevision > workspace.revision)
      void client.invalidateQueries({ queryKey: ["staff-workspace", workspace.id] });
  }, [client, overview.data?.applicationRevision, workspace.id, workspace.revision]);
  const href = (section: string) => `${base}/${section}${navigationQuery}`;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card role="region" aria-label="Business profile" className="gap-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 aria-hidden="true" className="size-4 text-muted-foreground" />
              <h2>Business profile</h2>
            </CardTitle>
            <CardDescription>Application-specific business details.</CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <Fact label="Legal business name">{workspace.businessName ?? "Not provided"}</Fact>
              <Fact label="Industry">
                {workspace.industryCode
                  ? `${workspace.industryCode} · ${industryByCode(workspace.industryCode)?.title ?? workspace.industryTaxonomyVersion}`
                  : "Not provided"}
              </Fact>
              <Fact label="Business address">
                {workspace.businessAddress
                  ? [
                      workspace.businessAddress.line1,
                      workspace.businessAddress.line2,
                      workspace.businessAddress.locality,
                      workspace.businessAddress.region,
                      workspace.businessAddress.postalCode,
                      workspace.businessAddress.countryCode,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "Not provided"}
              </Fact>
              <Fact label="Website">
                {workspace.website ? (
                  <a
                    href={workspace.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-info underline underline-offset-4"
                  >
                    {workspace.website}
                  </a>
                ) : (
                  "Not provided"
                )}
              </Fact>
              <Fact label="Years in business">Not provided</Fact>
              <Fact label="Employee count">Not provided</Fact>
            </DescriptionList>
            {workspace.setup.definitionVersion < 2 && (
              <p className="mt-5 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Legacy application: details not collected in the original setup remain Not provided.
              </p>
            )}
          </CardContent>
        </Card>
        <Card role="region" aria-label="Loan application" className="gap-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark aria-hidden="true" className="size-4 text-muted-foreground" />
              <h2>Loan application</h2>
            </CardTitle>
            <CardDescription>Recorded terms and the current application stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <Fact label="Requested amount">
                <span className="text-lg font-semibold tabular-nums">
                  {formatAmount(workspace.requestedAmount)}
                </span>
              </Fact>
              <Fact label="Current stage">{statusLabels[workspace.status]}</Fact>
              <Fact label="Product">{workspace.productName ?? "Not provided"}</Fact>
              <Fact label="Funding purposes">
                {workspace.fundingPurposes.length
                  ? workspace.fundingPurposes
                      .map((id) => fundingPurposeOptions.find((option) => option.id === id)?.label)
                      .join(", ")
                  : "Not provided"}
              </Fact>
              {workspace.otherPurposeDetail && (
                <Fact label="Other purpose details">{workspace.otherPurposeDetail}</Fact>
              )}
              {workspace.purpose && (
                <Fact label="Previous purpose response">{workspace.purpose}</Fact>
              )}
              <Fact label="Created">{new Date(workspace.createdAt).toLocaleString()}</Fact>
              <Fact label="Assigned officer">{workspace.assignedStaffName ?? "Unassigned"}</Fact>
              <Fact label="Target closing date">Not provided</Fact>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
      {overview.isPending || !overview.isFetchedAfterMount ? (
        <Loading>Loading financial overview and evidence…</Loading>
      ) : overview.error ? (
        <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        overview.data && (
          <FinancialOverview
            financialFacts={overview.data.financialFacts}
            onOpenSource={documents.openDocument}
          />
        )
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-label="Tasks" className="min-w-0">
            <ApplicationTasks applicationId={workspace.id} />
          </section>
          <ApplicationStages workspace={workspace} href={href} />
          {overview.data && !overview.error && (
            <TaxEvidence
              data={overview.data.taxDocuments}
              open={documents.openDocument}
              documentsHref={href("documents")}
            />
          )}
        </div>
        <div className="min-w-0 space-y-6">
          {aside}
          <RecentHistory applicationId={workspace.id} href={href("activity")} />
        </div>
      </div>
      {documents.renderWorkspace()}
    </div>
  );
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <DescriptionItem label={label}>{children}</DescriptionItem>;
}

function TaxEvidence({
  data,
  open,
  documentsHref,
}: {
  data: StaffOverview["taxDocuments"];
  open: (documentId: string, versionId: string) => void;
  documentsHref: string;
}) {
  return (
    <Card
      role="region"
      aria-label="Business tax evidence"
      id="business-tax-evidence"
      className="scroll-mt-6 gap-5"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>Uploaded evidence</h2>
        </CardTitle>
        <CardDescription>
          Documents and reviewed financial fields are separate from completed requirements.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="group/tax rounded-lg border">
          <summary className="disclosure flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold hover:bg-muted/40">
            Business tax returns · {data.documentCount}{" "}
            {data.documentCount === 1 ? "document" : "documents"}
            <ChevronDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open/tax:rotate-180"
            />
          </summary>
          <div className="space-y-4 border-t px-4 py-4 text-sm">
            <p className="font-medium">
              {data.versionCount} file versions · {data.reviewedCount} reviewed,{" "}
              {data.waitingForReviewCount} waiting for review · {data.staleCount} stale-source ·{" "}
              {data.rejectedCount} rejected
            </p>
            <p className="text-muted-foreground">
              Reviewed means at least one accepted financial field from the current source.{" "}
              {data.currentAcceptedPeriodCount} distinct fiscal periods have current reviewed
              fields. This is not a required-period completion count.
            </p>
            {data.documents.length ? (
              <ul className="space-y-3">
                {data.documents.map((document) => (
                  <li key={document.documentId} className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex min-w-0 items-start gap-2 font-medium break-words">
                        <FileText
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        {document.displayName}
                      </span>
                      <Badge variant="info">Evidence</Badge>
                    </div>
                    <div className="space-y-1.5">
                      <p>
                        {document.period
                          ? `Fiscal period ${document.period.start} – ${document.period.end}`
                          : "Fiscal period not confirmed"}
                      </p>
                      {document.classificationStale && (
                        <p className="text-muted-foreground">
                          Previous tax classification; current analysis is pending or unavailable.
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        Business subject: {document.subjectLabel ?? "Not provided"}
                      </p>
                      {document.expectedPeriod && (
                        <p>
                          Expected period {document.expectedPeriod.start} –{" "}
                          {document.expectedPeriod.end}
                        </p>
                      )}
                      {document.taskEvidenceState && (
                        <p>Linked requirement: {taskStates[document.taskEvidenceState]}</p>
                      )}
                      <p className="text-muted-foreground">
                        {document.versionCount}{" "}
                        {document.versionCount === 1 ? "version" : "versions"} ·{" "}
                        {document.reviewStatus.replaceAll("_", " ")} · Scan:{" "}
                        {document.scanState.replaceAll("_", " ")} · Analysis:{" "}
                        {document.processingState?.replaceAll("_", " ") ?? "Not available"}
                      </p>
                      <p>
                        {document.acceptedFactCount} current reviewed fields ·{" "}
                        {document.staleFactCount} stale-source fields
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto max-w-full py-2 text-left whitespace-normal"
                      onClick={() => open(document.documentId, document.currentVersionId)}
                    >
                      Open {document.displayName}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
                No business tax documents uploaded. Missing years remain requirements; they are not
                counted as documents.
              </p>
            )}
          </div>
        </details>
        <Link to={documentsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
          View all documents
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}
const taskStates = {
  open: "Needs action",
  submitted: "Waiting for lender review",
  needs_changes: "Changes requested",
  completed: "Completed",
  waived: "Waived",
  cancelled: "Cancelled / history",
} as const;
const stages = { submission: "Submission", approval: "Approval", closing: "Closing" } as const;
function ApplicationStages({
  workspace,
  href,
}: {
  workspace: StaffWorkspace;
  href: (section: string) => string;
}) {
  const api = useStaffApi();
  const base = `/applications/${workspace.id}`;
  const tasks = useQuery({
    queryKey: ["staff-tasks", workspace.id],
    queryFn: ({ signal }) => api.participantRequest(`${base}/tasks`, tasksViewSchema, { signal }),
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.error ? false : 15_000),
  });
  const checks = useQuery({
    queryKey: ["staff-checks", workspace.id],
    queryFn: ({ signal }) => api.participantRequest(`${base}/checks`, checksViewSchema, { signal }),
    refetchOnMount: "always",
    refetchInterval: (query) =>
      query.state.error ? false : checkRefreshInterval(query.state.data),
  });
  const currentStage = ["approved", "closing", "funded"].includes(workspace.status)
    ? "closing"
    : ["submitted", "in_review"].includes(workspace.status)
      ? "approval"
      : "submission";
  const error = tasks.error ?? checks.error;
  return (
    <Card role="region" aria-label="Application stages" className="gap-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>Application stages</h2>
        </CardTitle>
        <CardDescription>
          Current stage: {statusLabels[workspace.status]}. Inspect requirements, simulated checks
          and completed evidence; use the existing review and closing workflows to advance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <details className="group/setup rounded-lg border bg-card">
          <summary className="disclosure flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold hover:bg-muted/40">
            Initial setup · {workspace.setup.status === "completed" ? "Completed" : "In progress"}
            <ChevronDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open/setup:rotate-180"
            />
          </summary>
          <p className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm">
            <Badge variant={workspace.setup.status === "completed" ? "success" : "warning"}>
              {workspace.setup.status === "completed" ? "Completed answer" : "Action required"}
            </Badge>{" "}
            {workspace.setup.status === "completed"
              ? "Borrower confirmed the saved application answers."
              : "The borrower must confirm the answers and finish setup before entering the task portal."}
          </p>
        </details>
        {!error &&
          checks.isFetchedAfterMount &&
          checks.data?.checks
            .filter((check) => check.kind === "loan_footprint")
            .map((check) => (
              <LoanFootprintItem
                key={check.id}
                applicationId={workspace.id}
                check={check}
                savedAddress={workspace.businessAddress}
              />
            ))}
        {tasks.isPending ||
        checks.isPending ||
        !tasks.isFetchedAfterMount ||
        !checks.isFetchedAfterMount ? (
          <Loading>Loading requirements and checks…</Loading>
        ) : error ? (
          <ErrorNotice
            error={error}
            onRetry={() => {
              void tasks.refetch();
              void checks.refetch();
            }}
          />
        ) : (
          tasks.data &&
          checks.data &&
          Object.entries(stages).map(([stage, label]) => {
            const requirements = tasks.data.tasks.filter((task) => task.stage === stage);
            const results = checks.data.checks.filter(
              (check) => check.stage === stage && check.kind !== "loan_footprint",
            );
            const active = requirements.filter(
              (task) => !["completed", "waived", "cancelled"].includes(task.state),
            );
            return (
              <details
                key={stage}
                open={stage === currentStage}
                className="group/stage rounded-lg border bg-card"
              >
                <summary className="disclosure flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold hover:bg-muted/40">
                  {label} · {active.length} unfinished requirements
                  <ChevronDown
                    aria-hidden="true"
                    className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open/stage:rotate-180"
                  />
                </summary>
                <div className="space-y-2 border-t px-4 py-4 text-sm">
                  {!requirements.length && !results.length && (
                    <p className="text-muted-foreground">
                      No requirements or checks recorded for this stage.
                    </p>
                  )}
                  {requirements.map((task) => {
                    const finished = ["completed", "waived", "cancelled"].includes(task.state);
                    return (
                      <div
                        key={task.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-3"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                              finished
                                ? "bg-success-soft text-success"
                                : task.state === "submitted"
                                  ? "bg-info-soft text-info"
                                  : "bg-warning-soft text-warning",
                            )}
                          >
                            {finished ? (
                              <CircleCheck className="size-4" />
                            ) : (
                              <ClipboardList className="size-4" />
                            )}
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <Link
                              to={`${href("tasks")}${href("tasks").includes("?") ? "&" : "?"}task=${task.id}`}
                              className="font-medium break-words text-foreground underline-offset-4 hover:text-info hover:underline"
                            >
                              {task.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {taskStates[task.state]} · {task.required ? "Required" : "Optional"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={
                            finished ? "secondary" : task.state === "submitted" ? "info" : "warning"
                          }
                        >
                          {finished
                            ? "Requirement record"
                            : task.state === "submitted"
                              ? "Review action"
                              : "Action required"}
                        </Badge>
                      </div>
                    );
                  })}
                  {results.map((check) => {
                    const run = check.runs.find((run) => run.id === check.currentRunId);
                    const state = !run
                      ? "Waiting for input"
                      : run.stale
                        ? "Stale result"
                        : run.resolved
                          ? "Reviewed by staff"
                          : run.outcome === "clear"
                            ? "Simulated clear"
                            : run.outcome === "needs_review"
                              ? "Needs staff review"
                              : run.outcome === "unable_to_verify"
                                ? "Unable to verify"
                                : run.status.replaceAll("_", " ");
                    return (
                      <div
                        key={check.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                          >
                            <ShieldCheck className="size-4" />
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <Link
                              to={href("checks")}
                              className="font-medium break-words text-foreground underline-offset-4 hover:text-info hover:underline"
                            >
                              {check.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {state} · Simulated check
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline">Check result</Badge>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
                    {stage === "submission" && (
                      <a
                        href="#business-tax-evidence"
                        className="inline-flex items-center gap-1 font-medium text-info underline-offset-4 hover:underline"
                      >
                        Inspect uploaded business tax evidence
                      </a>
                    )}
                    <Link
                      to={href(stage === "closing" ? "closing" : "review")}
                      className="inline-flex items-center gap-1 font-medium text-info underline-offset-4 hover:underline"
                    >
                      {stage === "closing" ? "Open closing workflow" : "Open review workflow"}
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </div>
                </div>
              </details>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
function RecentHistory({ applicationId, href }: { applicationId: string; href: string }) {
  const api = useStaffApi();
  const history = useQuery({
    queryKey: ["staff-overview-history", applicationId],
    queryFn: ({ signal }) =>
      api.participantRequest(
        `/applications/${applicationId}/activity?limit=5`,
        activityViewSchema,
        { signal },
      ),
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.error ? false : 30_000),
  });
  return (
    <Card role="region" aria-label="Recent activity" className="gap-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>Recent activity</h2>
        </CardTitle>
        <CardDescription>Recorded application history.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {history.isPending || !history.isFetchedAfterMount ? (
          <Loading>Loading recent activity…</Loading>
        ) : history.error ? (
          <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data?.entries.length ? (
          <ol className="space-y-0 text-sm">
            {history.data.entries.map((entry, index) => (
              <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < history.data.entries.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-3 bottom-0 left-[4.5px] w-px bg-border"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="relative mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-info bg-card"
                />
                <div className="min-w-0">
                  <p className="break-words">{entry.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.actor} · {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        )}
        <Link to={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          View full activity
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}
