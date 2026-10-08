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
import { checkRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Link } from "react-router";
import { formatAmount, useStaffApi } from "./api";
import { useApplicationDocuments } from "./documents";
import { FinancialOverview } from "./financial-overview";
import { LoanFootprintItem } from "./loan-footprint";
import { ErrorNotice, Loading, statusLabels } from "./ui";

export function ApplicationOverview({
  workspace,
  navigationQuery,
}: {
  workspace: StaffWorkspace;
  navigationQuery: string;
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card role="region" aria-label="Business profile">
          <CardHeader>
            <CardTitle>
              <h2>Business profile</h2>
            </CardTitle>
            <CardDescription>Application-specific business details.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
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
                    className="break-all underline underline-offset-4"
                  >
                    {workspace.website}
                  </a>
                ) : (
                  "Not provided"
                )}
              </Fact>
              <Fact label="Years in business">Not provided</Fact>
              <Fact label="Employee count">Not provided</Fact>
            </dl>
            {workspace.setup.definitionVersion < 2 && (
              <p className="mt-4 text-sm text-muted-foreground">
                Legacy application: details not collected in the original setup remain Not provided.
              </p>
            )}
          </CardContent>
        </Card>
        <Card role="region" aria-label="Loan application">
          <CardHeader>
            <CardTitle>
              <h2>Loan application</h2>
            </CardTitle>
            <CardDescription>Recorded terms and the current application stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Fact label="Requested amount">{formatAmount(workspace.requestedAmount)}</Fact>
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
            </dl>
          </CardContent>
        </Card>
      </div>
      {overview.isPending || !overview.isFetchedAfterMount ? (
        <Loading>Loading financial overview and evidence…</Loading>
      ) : overview.error ? (
        <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        overview.data && (
          <>
            <FinancialOverview
              financialFacts={overview.data.financialFacts}
              onOpenSource={documents.openDocument}
            />
            <TaxEvidence
              data={overview.data.taxDocuments}
              open={documents.openDocument}
              documentsHref={href("documents")}
            />
          </>
        )
      )}
      <ApplicationStages workspace={workspace} href={href} />
      <RecentHistory applicationId={workspace.id} href={href("activity")} />
      {documents.renderWorkspace()}
    </div>
  );
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
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
    <Card role="region" aria-label="Business tax evidence" id="business-tax-evidence">
      <CardHeader>
        <CardTitle>
          <h2>Uploaded evidence</h2>
        </CardTitle>
        <CardDescription>
          Documents and reviewed financial fields are separate from completed requirements.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Business tax returns · {data.documentCount}{" "}
            {data.documentCount === 1 ? "document" : "documents"}
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            <p>
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
                  <li key={document.documentId} className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-medium">
                        {document.displayName}
                      </span>
                      <Badge variant="outline">Evidence</Badge>
                    </div>
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
                      {document.versionCount} {document.versionCount === 1 ? "version" : "versions"}{" "}
                      · {document.reviewStatus.replaceAll("_", " ")} · Scan:{" "}
                      {document.scanState.replaceAll("_", " ")} · Analysis:{" "}
                      {document.processingState?.replaceAll("_", " ") ?? "Not available"}
                    </p>
                    <p>
                      {document.acceptedFactCount} current reviewed fields ·{" "}
                      {document.staleFactCount} stale-source fields
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-w-full whitespace-normal text-left"
                      onClick={() => open(document.documentId, document.currentVersionId)}
                    >
                      Open {document.displayName}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No business tax documents uploaded. Missing years remain requirements; they are not
                counted as documents.
              </p>
            )}
          </div>
        </details>
        <Link to={documentsHref} className={buttonVariants({ variant: "outline" })}>
          View all documents
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
    <Card role="region" aria-label="Application stages">
      <CardHeader>
        <CardTitle>
          <h2>Application stages</h2>
        </CardTitle>
        <CardDescription>
          Current stage: {statusLabels[workspace.status]}. Inspect requirements, simulated checks
          and completed evidence; use the existing review and closing workflows to advance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Initial setup · {workspace.setup.status === "completed" ? "Completed" : "In progress"}
          </summary>
          <p className="mt-3 text-sm">
            <Badge variant="outline">
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
              <details key={stage} open={stage === currentStage} className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {label} · {active.length} unfinished requirements
                </summary>
                <div className="mt-4 space-y-3 text-sm">
                  {!requirements.length && !results.length && (
                    <p>No requirements or checks recorded for this stage.</p>
                  )}
                  {requirements.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0 space-y-2">
                        <Link
                          to={`${href("tasks")}${href("tasks").includes("?") ? "&" : "?"}task=${task.id}`}
                          className="break-words font-medium underline underline-offset-4"
                        >
                          {task.title}
                        </Link>
                        <p className="text-muted-foreground">
                          {taskStates[task.state]} · {task.required ? "Required" : "Optional"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {["completed", "waived", "cancelled"].includes(task.state)
                          ? "Requirement record"
                          : task.state === "submitted"
                            ? "Review action"
                            : "Action required"}
                      </Badge>
                    </div>
                  ))}
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
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-2">
                          <Link
                            to={href("checks")}
                            className="break-words font-medium underline underline-offset-4"
                          >
                            {check.title}
                          </Link>
                          <p className="text-muted-foreground">{state} · Simulated check</p>
                        </div>
                        <Badge variant="outline">Check result</Badge>
                      </div>
                    );
                  })}
                  {stage === "submission" && (
                    <a
                      href="#business-tax-evidence"
                      className="inline-block underline underline-offset-4"
                    >
                      Inspect uploaded business tax evidence
                    </a>
                  )}
                  <Link
                    to={href(stage === "closing" ? "closing" : "review")}
                    className="block underline underline-offset-4"
                  >
                    {stage === "closing" ? "Open closing workflow" : "Open review workflow"}
                  </Link>
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
    <Card role="region" aria-label="Recent activity">
      <CardHeader>
        <CardTitle>
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
          <ol className="space-y-3 text-sm">
            {history.data.entries.map((entry) => (
              <li key={entry.id}>
                <p className="break-words">{entry.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.actor} · {new Date(entry.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        )}
        <Link to={href} className={buttonVariants({ variant: "outline" })}>
          View full activity
        </Link>
      </CardContent>
    </Card>
  );
}
