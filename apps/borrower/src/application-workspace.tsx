import {
  type ApplicationSelection,
  applicationPageSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
  fundingPurposeOptions,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { useDemoApplication } from "@keycade/ui/components/demo-kit";
import type {
  AuthenticatedSession,
  IdentityControls,
} from "@keycade/ui/components/identity-portal";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { AccountList } from "./accounts";
import { ApplicationActivity } from "./activity";
import { ApiError, formatAmount, onApplicationAccessLoss, request } from "./api";
import { ApplicationTimeline } from "./application-timeline";
import { ApplicationClosing } from "./closing";
import { DashboardUpload } from "./dashboard-upload";
import { ApplicationDocuments } from "./documents";
import { ApplicationPeople } from "./participants";
import { ApplicationReadiness } from "./readiness";
import { ApplicationReview } from "./review";
import { SetupWizard } from "./setup-wizard";
import { ApplicationSignatures } from "./signatures";
import { ApplicationTasks } from "./tasks";
import { applicationPath, ErrorNotice, Loading } from "./workspace-ui";

const statusLabels: Record<ApplicationSelection["status"], string> = {
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
const statusDescriptions: Record<ApplicationSelection["status"], string> = {
  draft: "Initial setup is still in progress.",
  collecting_information:
    "Your application is collecting information; it has not been submitted or approved.",
  needs_information:
    "The bank has requested more information. Review your available tasks for next steps.",
  submitted: "Your application has been submitted and is waiting for review.",
  in_review: "The bank is reviewing your application.",
  approved:
    "Your application is approved. Closing requirements may still be needed before funding.",
  declined: "This application was declined. You can return to your other applications.",
  closing:
    "Your application is in closing. Review available tasks for remaining closing requirements.",
  funded: "Simulated funding has been recorded. View Closing for the funded account summary.",
  withdrawn: "This application was withdrawn. You can return to your other applications.",
};
const setupSteps: Record<ApplicationSelection["currentStep"], string> = {
  business_name: "Legal business name",
  business_address: "Business address",
  business_ein: "Business EIN",
  website: "Website",
  other_purpose: "Other funding purpose",
  product: "Requested amount",
  amount: "Requested amount",
  purpose: "Funding purposes",
  industry: "Industry",
  review: "Review and finish",
};
function UpdatedAt({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )}
    </time>
  );
}
function Summary({ application }: { application: ApplicationSelection }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">Product</dt>
        <dd className="mt-1 font-medium">{application.productName ?? "Not assigned"}</dd>
      </div>
      {application.accessScope === "full" && (
        <div>
          <dt className="text-muted-foreground">Requested amount</dt>
          <dd className="mt-1 font-medium">
            {application.requestedAmount
              ? formatAmount(application.requestedAmount)
              : "Not provided yet"}
          </dd>
        </div>
      )}
      <div>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="mt-1">{statusLabels[application.status]}</dd>
      </div>
      {application.taskProgress && (
        <div>
          <dt className="text-muted-foreground">Required tasks satisfied</dt>
          <dd className="mt-1">
            {application.taskProgress.requiredCompleted} of {application.taskProgress.required}
          </dd>
        </div>
      )}
      <div>
        <dt className="text-muted-foreground">Last updated</dt>
        <dd className="mt-1">
          <UpdatedAt value={application.updatedAt} />
        </dd>
      </div>
    </dl>
  );
}

export function ApplicationList({
  session,
  saved,
}: {
  session: AuthenticatedSession;
  saved: boolean;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const list = useInfiniteQuery({
    queryKey: ["applications", session.bank.id, session.user.email],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications?limit=20${pageParam ? `&after=${pageParam}` : ""}`,
        applicationPageSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  async function open(application: ApplicationSelection) {
    setBusy(application.id);
    setError(null);
    try {
      if (application.claimRequired)
        await request(
          `/api/v1/banks/${session.bank.id}/applications/${application.id}/claim`,
          applicationSetupSchema,
          { method: "POST", bankId: session.bank.id, actorEmail: session.user.email, body: {} },
        );
      const current = await request(
        `/api/v1/banks/${session.bank.id}/applications/${application.id}/destination`,
        applicationSelectionSchema,
        { bankId: session.bank.id, actorEmail: session.user.email },
      );
      navigate(
        applicationPath(application.id, session.bank.slug, current.nextDestination === "setup"),
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(null);
    }
  }
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  // IDs, not matching names, establish business identity. Unlinked drafts stay separate.
  const groups = new Map<string, ApplicationSelection[]>();
  for (const item of items) {
    const key = item.businessId ?? `draft:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">You’re signed in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your applications</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose an application to continue. Each has its own saved progress.
        </p>
      </div>
      {saved && (
        <Alert role="status">
          <AlertTitle>Your progress is saved.</AlertTitle>
          <AlertDescription>Continue setup whenever you’re ready.</AlertDescription>
        </Alert>
      )}
      {Boolean(error) && <ErrorNotice error={error} />}
      {list.isPending ? (
        <Loading />
      ) : list.error && !list.isFetchNextPageError ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <Card className="shadow-sm ring-0">
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
            <CardDescription>
              Start your first application when you’re ready. Only applications shared with your
              account appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "application" : "applications"} shown
            {list.hasNextPage ? " · More available below" : ""}
          </p>
          {[...groups].map(([key, applications]) => {
            const name = applications[0]?.businessName ?? "Business not provided";
            return (
              <section key={key} aria-label={name} className="space-y-3">
                <h2 className="break-words text-xl font-semibold">{name}</h2>
                <div className="grid items-start gap-4 lg:grid-cols-2">
                  {applications.map((application) => (
                    <article key={application.id} aria-label={`Application ${application.id}`}>
                      <Card className="shadow-sm ring-0">
                        <CardHeader>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle>Application {application.id.slice(-8)}</CardTitle>
                            {application.accessScope === "assigned" ? (
                              <Badge variant="secondary">Limited access</Badge>
                            ) : (
                              <Badge variant="outline">
                                {application.nextDestination === "closed"
                                  ? "Closed"
                                  : application.setupStatus === "completed"
                                    ? "Initial setup complete"
                                    : "Setup in progress"}
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <Summary application={application} />
                          {application.nextDestination === "setup" && (
                            <p className="text-sm text-muted-foreground">
                              Next: {setupSteps[application.currentStep]}
                              {application.claimRequired ? " · Confirm this draft to continue" : ""}
                            </p>
                          )}
                          {application.accessScope === "assigned" && (
                            <p className="text-sm text-muted-foreground">
                              Only your assigned work and permitted information will be available.
                            </p>
                          )}
                          <Button
                            disabled={busy !== null}
                            variant={
                              application.nextDestination === "closed" ? "outline" : "default"
                            }
                            onClick={() => void open(application)}
                          >
                            {busy === application.id
                              ? "Opening…"
                              : application.nextDestination === "setup"
                                ? "Continue setup"
                                : "Open application"}
                          </Button>
                        </CardContent>
                      </Card>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {list.isFetchNextPageError && (
        <ErrorNotice error={list.error} onRetry={() => void list.fetchNextPage()} />
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading more…" : "Show more applications"}
        </Button>
      )}
      <Link
        className={buttonVariants({ variant: "outline" })}
        to={`/apply?bank=${encodeURIComponent(session.bank.slug)}`}
      >
        Start a new application
      </Link>
      {list.data && !list.error && <AccountList session={session} />}
    </section>
  );
}

export function ApplicationRoute({
  session,
  setup = false,
  controls,
}: {
  session: AuthenticatedSession;
  setup?: boolean;
  controls: IdentityControls;
}) {
  const { applicationId = "", "*": view = "" } = useParams();
  return (
    <ScopedApplicationRoute
      key={`${session.bank.id}:${session.user.email}:${applicationId}`}
      session={session}
      setup={setup}
      controls={controls}
      applicationId={applicationId}
      view={view}
    />
  );
}

function ScopedApplicationRoute({
  session,
  setup,
  controls,
  applicationId,
  view,
}: {
  session: AuthenticatedSession;
  setup: boolean;
  controls: IdentityControls;
  applicationId: string;
  view: string;
}) {
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<unknown>(null);
  const denied = useRef(false);
  const loseAccess = useCallback(
    (error: unknown) => {
      if (denied.current) return;
      denied.current = true;
      // Keep the denial above the destination observer. Removing its cached data
      // must not remount the portal and silently restore discarded editors.
      setAccessError(error);
      const scoped = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.includes(session.bank.id) &&
        query.queryKey.includes(session.user.email) &&
        (query.queryKey.includes(applicationId) ||
          ["applications", "accounts"].includes(String(query.queryKey[0])));
      void client.cancelQueries({ predicate: scoped });
      client.removeQueries({ predicate: scoped });
    },
    [client, session.bank.id, session.user.email, applicationId],
  );
  useEffect(
    () =>
      onApplicationAccessLoss((event) => {
        if (
          event.bankId === session.bank.id &&
          event.applicationId === applicationId &&
          (!event.actorEmail || event.actorEmail === session.user.email)
        )
          loseAccess(event.error);
      }),
    [applicationId, session.bank.id, session.user.email, loseAccess],
  );
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        const error = event.query.state.error;
        if (
          event.query.queryKey.includes(applicationId) &&
          event.query.queryKey.includes(session.bank.id) &&
          event.query.queryKey.includes(session.user.email) &&
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        )
          loseAccess(error);
      }),
    [client, applicationId, session.bank.id, session.user.email, loseAccess],
  );
  const destination = useQuery({
    queryKey: ["destination", session.bank.id, session.user.email, applicationId, setup],
    enabled: !accessError,
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/destination`,
        applicationSelectionSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    gcTime: 0,
  });
  const data = destination.data;
  useDemoApplication(applicationId, accessError || destination.error ? null : data?.businessName);
  const back = (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
    >
      Your applications
    </Link>
  );
  if (accessError)
    return (
      <div className="space-y-4">
        {back}
        <ErrorNotice
          error={accessError}
          onRetry={() => {
            denied.current = false;
            setAccessError(null);
          }}
        />
      </div>
    );
  if (destination.isPending) return <Loading />;
  if (
    destination.error &&
    (!data ||
      (destination.error instanceof ApiError && [401, 403, 404].includes(destination.error.status)))
  )
    return (
      <div className="space-y-4">
        <ErrorNotice error={destination.error} onRetry={() => void destination.refetch()} />
        {back}
      </div>
    );
  if (!data) return null;
  if (data.nextDestination === "setup" && view === "review")
    return (
      <section className="space-y-5">
        {back}
        <Link
          className="block text-sm underline underline-offset-4"
          to={applicationPath(applicationId, session.bank.slug, true)}
        >
          Return to setup
        </Link>
        <ApplicationReview session={session} applicationId={applicationId} />
      </section>
    );
  if (data.nextDestination === "setup" && !setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug, true)} />;
  if (data.nextDestination !== "setup" && setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug)} />;
  if (data.nextDestination === "setup")
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SetupWizard
          key={`${session.bank.id}:${session.user.email}:${applicationId}`}
          session={session}
          applicationId={applicationId}
          refreshSession={controls.refreshSession}
        />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            className="underline underline-offset-4"
            to={`/applications/${applicationId}/review?bank=${encodeURIComponent(session.bank.slug)}`}
          >
            Review status or withdraw this application
          </Link>
        </p>
      </div>
    );
  if (data.nextDestination === "closed" && data.setupStatus !== "completed")
    return <ClosedApplication data={data} session={session} />;
  return (
    <ApplicationPortal
      key={`${session.bank.id}:${session.user.email}:${applicationId}`}
      session={session}
      applicationId={applicationId}
      view={view}
      onAccessLost={loseAccess}
    />
  );
}

function ClosedApplication({
  data,
  session,
}: {
  data: ApplicationSelection;
  session: AuthenticatedSession;
}) {
  const bankSlug = session.bank.slug;
  const back = (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={`/?bank=${encodeURIComponent(bankSlug)}`}
    >
      Your applications
    </Link>
  );
  return (
    <section className="w-full space-y-5">
      {back}
      <Card className="shadow-sm ring-0">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">This application is closed</h1>
          </CardTitle>
          <CardDescription>{data.businessName ?? "Business application"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-6">{statusDescriptions[data.status]}</p>
          <Summary application={data} />
        </CardContent>
      </Card>
      <ApplicationReview session={session} applicationId={data.id} hideForbidden />
    </section>
  );
}

function ApplicationPortal({
  session,
  applicationId,
  view,
  onAccessLost,
}: {
  session: AuthenticatedSession;
  applicationId: string;
  view: string;
  onAccessLost: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const active = view || "overview";
  const dashboard = active === "overview" || active === "tasks";
  const contextRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousView = useRef(active);
  useEffect(() => {
    if (previousView.current !== active) {
      if (dashboard) returnFocus.current?.focus();
      else contextRef.current?.focus();
      previousView.current = active;
    }
  }, [active, dashboard]);
  const detail = useQuery({
    queryKey: ["portal", session.bank.id, session.user.email, applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/portal`,
        applicationPortalSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  useDemoApplication(applicationId, detail.error ? null : detail.data?.businessName);
  const path = (section = "") =>
    `/applications/${applicationId}${section ? `/${section}` : ""}?bank=${encodeURIComponent(session.bank.slug)}`;
  const back = (
    <Link
      className="inline-flex text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
    >
      Your applications
    </Link>
  );
  if (detail.isPending || !detail.isFetchedAfterMount) return <Loading />;
  if (
    detail.error &&
    (!detail.data ||
      (detail.error instanceof ApiError &&
        ([401, 403, 404].includes(detail.error.status) || detail.error.code === "SETUP_REQUIRED")))
  ) {
    if (detail.error instanceof ApiError && detail.error.code === "SETUP_REQUIRED")
      return <Navigate replace to={applicationPath(applicationId, session.bank.slug, true)} />;
    return (
      <div className="space-y-4">
        {back}
        <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  const data = detail.data;
  if (!data) return null;
  const limited = data.accessScope === "assigned";
  return (
    <section
      className="space-y-6"
      onClick={(event) => {
        // Shared workflow components use ordinary anchors. Keep their same-application
        // destinations in this mounted workspace so returning preserves task edits.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const link = (event.target as HTMLElement).closest("a");
        if (!link || link.target || link.hasAttribute("download")) return;
        const url = new URL(link.href);
        if (
          url.origin !== window.location.origin ||
          !(
            url.pathname === `/applications/${applicationId}` ||
            url.pathname.startsWith(`/applications/${applicationId}/`)
          )
        )
          return;
        event.preventDefault();
        navigate(`${url.pathname}${url.search}${url.hash}`);
      }}
    >
      {back}
      {detail.error && <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-3xl font-semibold tracking-tight">
            {data.businessName ?? "Business application"}
          </h1>
          <p className="text-sm text-muted-foreground">Application {data.id.slice(-8)}</p>
        </div>
        {limited && <Badge variant="secondary">Limited access</Badge>}
      </header>
      {["declined", "withdrawn"].includes(data.status) && (
        <Alert role="status">
          <AlertTitle>This application is closed</AlertTitle>
          <AlertDescription>{statusDescriptions[data.status]}</AlertDescription>
        </Alert>
      )}
      {!dashboard && (
        <Link to={path()} className="inline-flex text-sm font-medium underline underline-offset-4">
          Back to task dashboard
        </Link>
      )}
      <div
        hidden={!dashboard}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          const link = target.closest("a");
          if (link) returnFocus.current = link;
        }}
      >
        <section
          aria-label="Current application"
          className="mb-5 space-y-2 rounded-xl bg-card p-4 lg:hidden"
        >
          <h2 className="text-sm font-semibold">Current application</h2>
          <p className="break-words text-sm">{data.businessName ?? "Business application"}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{statusLabels[data.status]}</Badge>
            {!limited && data.requestedAmount && <span>{formatAmount(data.requestedAmount)}</span>}
          </div>
        </section>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-8">
          <section aria-label="Application tasks" className="min-w-0">
            <ApplicationTasks
              session={session}
              applicationId={applicationId}
              businessName={data.businessName ?? "your business"}
              active={dashboard}
            />
            <section
              aria-label="Application actions"
              className="mt-5 space-y-4 rounded-xl bg-card p-5"
            >
              <h2 className="text-sm font-semibold">Next steps</h2>
              {data.canReview && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {data.status === "needs_information"
                      ? "Review the lender’s request, complete any returned tasks, then resubmit."
                      : "Review your application’s status and available submission actions."}
                  </p>
                  <Link className={buttonVariants({ variant: "outline" })} to={path("review")}>
                    Review and submit application
                  </Link>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Open your permitted simulated signature requests.
                </p>
                <Link
                  to={path("signatures")}
                  className="inline-flex text-sm font-medium underline underline-offset-4"
                >
                  View signatures
                </Link>
              </div>
              {data.canReview && ["approved", "closing", "funded"].includes(data.status) && (
                <Link to={path("closing")} className={buttonVariants({ variant: "outline" })}>
                  {data.status === "funded" ? "View funded account" : "View closing requirements"}
                </Link>
              )}
            </section>
          </section>
          <aside aria-label="Application details" className="min-w-0 space-y-6">
            <Card className="shadow-sm ring-0">
              <CardHeader>
                <CardTitle>
                  <h2>Application details</h2>
                </CardTitle>
                <CardDescription className="break-words">
                  {data.businessName ?? "Business application"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1">
                  {!limited && (
                    <p className="break-words text-3xl font-semibold tracking-tight">
                      {data.requestedAmount
                        ? formatAmount(data.requestedAmount)
                        : "Amount not provided"}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {data.productName ?? "Product not assigned"}
                  </p>
                </div>
                {!limited && (data.fundingPurposes.length > 0 || data.purpose) && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Funding purposes</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {data.fundingPurposes.length > 0
                        ? data.fundingPurposes
                            .map(
                              (id) =>
                                fundingPurposeOptions.find((option) => option.id === id)?.label ??
                                id,
                            )
                            .join(", ")
                        : data.purpose}
                    </p>
                    {data.fundingPurposes.includes("other") && data.otherPurposeDetail && (
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {data.otherPurposeDetail}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-3 rounded-lg bg-muted/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Current stage</span>
                    <Badge variant="outline">{statusLabels[data.status]}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {limited
                      ? "Your access is limited to assigned work and permitted information."
                      : statusDescriptions[data.status]}
                  </p>
                  {!limited && data.setupStatus === "completed" && (
                    <Badge variant="secondary">Initial setup complete</Badge>
                  )}
                </div>
                <ApplicationTimeline application={data} />
                <p className="text-xs text-muted-foreground">
                  Updated <UpdatedAt value={data.updatedAt} />
                </p>
              </CardContent>
            </Card>
            <details className="rounded-xl bg-card p-5">
              <summary className="cursor-pointer text-sm font-medium">Task readiness</summary>
              <div className="mt-4">
                <ApplicationReadiness
                  session={session}
                  applicationId={applicationId}
                  active={dashboard}
                />
              </div>
            </details>
            <DashboardUpload
              session={session}
              applicationId={applicationId}
              active={dashboard}
              onAccessLost={onAccessLost}
              documentsHref={path("documents")}
            />
            <section aria-label="Application contacts" className="space-y-4 rounded-xl bg-card p-5">
              <h2 className="text-sm font-semibold">Your loan officer</h2>
              {data.loanOfficer ? (
                <div className="space-y-1 text-sm">
                  <p>{data.loanOfficer.displayName}</p>
                  <p className="break-all text-muted-foreground">{data.loanOfficer.email}</p>
                  <Badge variant="secondary">Synthetic contact</Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  A loan officer has not been assigned yet.
                </p>
              )}
              <Link
                to={path("people")}
                className="inline-flex text-sm font-medium underline underline-offset-4"
              >
                People and access
              </Link>
            </section>
            <section aria-label="Application history" className="space-y-2 px-5">
              <h2 className="text-sm font-semibold">History</h2>
              <p className="text-sm text-muted-foreground">
                See the activity you have permission to view.
              </p>
              <Link
                to={path("activity")}
                className="inline-flex text-sm font-medium underline underline-offset-4"
              >
                View activity
              </Link>
            </section>
          </aside>
        </div>
      </div>
      {!dashboard && (
        <div ref={contextRef} tabIndex={-1} className="outline-none">
          {active === "closing" ? (
            <ApplicationClosing session={session} applicationId={applicationId} />
          ) : active === "review" ? (
            <ApplicationReview session={session} applicationId={applicationId} />
          ) : active === "people" ? (
            <ApplicationPeople session={session} applicationId={applicationId} />
          ) : active === "documents" ? (
            <ApplicationDocuments session={session} applicationId={applicationId} />
          ) : active === "signatures" ? (
            <ApplicationSignatures session={session} applicationId={applicationId} />
          ) : active === "activity" ? (
            <ApplicationActivity session={session} applicationId={applicationId} />
          ) : (
            <Card className="shadow-sm ring-0">
              <CardHeader>
                <CardTitle>
                  <h2>Page not found</h2>
                </CardTitle>
                <CardDescription>Return to your task dashboard to continue.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
