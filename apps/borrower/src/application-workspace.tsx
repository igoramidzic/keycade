import {
  type ApplicationSelection,
  applicationPageSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
  fundingPurposeOptions,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { IdentityAvatar } from "@keycade/ui/components/app-shell";
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
import { EmptyState } from "@keycade/ui/components/empty-state";
import type {
  AuthenticatedSession,
  IdentityControls,
} from "@keycade/ui/components/identity-portal";
import { backLinkClassName, PageHeader } from "@keycade/ui/components/page-header";
import { applicationStatusTone, StatusPill } from "@keycade/ui/components/status-pill";
import { cn } from "@keycade/ui/lib/utils";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CircleCheck,
  FilePenLine,
  FileSignature,
  FolderOpen,
  History,
  ListChecks,
  Plus,
  Users,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
      {application.accessScope === "full" && (
        <div className="col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">Requested amount</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {application.requestedAmount
              ? formatAmount(application.requestedAmount)
              : "Not provided yet"}
          </dd>
        </div>
      )}
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">Product</dt>
        <dd className="mt-1 font-medium break-words">
          {application.productName ?? "Not assigned"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">Status</dt>
        <dd className="mt-1">
          <StatusPill tone={applicationStatusTone(application.status)}>
            {statusLabels[application.status]}
          </StatusPill>
        </dd>
      </div>
      {application.taskProgress && (
        <div className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">Required tasks satisfied</dt>
          <dd className="mt-1 space-y-1.5">
            <span className="font-medium tabular-nums">
              {application.taskProgress.requiredCompleted} of {application.taskProgress.required}
            </span>
            <MeterBar
              value={application.taskProgress.requiredCompleted}
              max={application.taskProgress.required}
            />
          </dd>
        </div>
      )}
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">Last updated</dt>
        <dd className="mt-1">
          <UpdatedAt value={application.updatedAt} />
        </dd>
      </div>
    </dl>
  );
}

/** Decorative fill bar; the adjacent text states the exact count. */
function MeterBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span
      aria-hidden="true"
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        className="block h-full rounded-full bg-success transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </span>
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
    <section className="space-y-8">
      <PageHeader
        eyebrow="You’re signed in"
        title="Your applications"
        description="Choose an application to continue. Each has its own saved progress."
        actions={
          <Link
            className={buttonVariants()}
            to={`/apply?bank=${encodeURIComponent(session.bank.slug)}`}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Start a new application
          </Link>
        }
      />
      {saved && (
        <Alert role="status" variant="success">
          <CircleCheck aria-hidden="true" />
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
        <EmptyState
          titleAs="h2"
          icon={FolderOpen}
          title="No applications yet"
          description="Start your first application when you’re ready. Only applications shared with your account appear here."
        />
      ) : (
        <div className="space-y-10">
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "application" : "applications"} shown
            {list.hasNextPage ? " · More available below" : ""}
          </p>
          {[...groups].map(([key, applications]) => {
            const name = applications[0]?.businessName ?? "Business not provided";
            return (
              <section key={key} aria-label={name} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs">
                    <Building2 aria-hidden="true" className="size-4.5" />
                  </span>
                  <h2 className="min-w-0 text-lg font-semibold tracking-tight break-words">
                    {name}
                  </h2>
                </div>
                <div className="grid items-stretch gap-4 lg:grid-cols-2">
                  {applications.map((application) => (
                    <article
                      key={application.id}
                      aria-label={`Application ${application.id}`}
                      className="min-w-0"
                    >
                      <Card className="h-full gap-0 py-0 transition-shadow hover:shadow-md">
                        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
                          <p className="font-semibold tracking-tight">
                            Application {application.id.slice(-8)}
                          </p>
                          {application.accessScope === "assigned" ? (
                            <Badge variant="secondary">Limited access</Badge>
                          ) : (
                            <StatusPill
                              tone={
                                application.nextDestination === "closed"
                                  ? "neutral"
                                  : application.setupStatus === "completed"
                                    ? "success"
                                    : "warning"
                              }
                            >
                              {application.nextDestination === "closed"
                                ? "Closed"
                                : application.setupStatus === "completed"
                                  ? "Initial setup complete"
                                  : "Setup in progress"}
                            </StatusPill>
                          )}
                        </div>
                        <div className="flex-1 space-y-4 px-6 pt-4 pb-5">
                          <Summary application={application} />
                          {application.nextDestination === "setup" && (
                            <p className="rounded-lg bg-warning-soft/70 px-3 py-2 text-sm text-foreground">
                              Next: {setupSteps[application.currentStep]}
                              {application.claimRequired ? " · Confirm this draft to continue" : ""}
                            </p>
                          )}
                          {application.accessScope === "assigned" && (
                            <p className="text-sm text-muted-foreground">
                              Only your assigned work and permitted information will be available.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-end border-t bg-muted/40 px-6 py-3.5">
                          <Button
                            loading={busy === application.id}
                            disabled={busy !== null}
                            variant={
                              application.nextDestination === "closed" ? "outline" : "default"
                            }
                            onClick={() => void open(application)}
                          >
                            {application.nextDestination === "setup"
                              ? "Continue setup"
                              : "Open application"}
                            <ArrowRight aria-hidden="true" data-icon="inline-end" />
                          </Button>
                        </div>
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
          loading={list.isFetchingNextPage}
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Show more applications
        </Button>
      )}
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
  const back = <BackToApplications bankSlug={session.bank.slug} />;
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
      <section className="mx-auto w-full max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {back}
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to={applicationPath(applicationId, session.bank.slug, true)}
          >
            Return to setup
          </Link>
        </div>
        <ApplicationReview session={session} applicationId={applicationId} />
      </section>
    );
  if (data.nextDestination === "setup" && !setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug, true)} />;
  if (data.nextDestination !== "setup" && setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug)} />;
  if (data.nextDestination === "setup")
    return (
      <div className="mx-auto w-full max-w-5xl">
        <SetupWizard
          key={`${session.bank.id}:${session.user.email}:${applicationId}`}
          session={session}
          applicationId={applicationId}
          refreshSession={controls.refreshSession}
        />
        <p className="mt-8 text-center text-sm text-muted-foreground lg:ml-[18rem]">
          <Link
            className="underline underline-offset-4 hover:text-foreground"
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
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <BackToApplications bankSlug={session.bank.slug} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">This application is closed</h1>
          </CardTitle>
          <CardDescription>{data.businessName ?? "Business application"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-6">{statusDescriptions[data.status]}</p>
          <Summary application={data} />
        </CardContent>
      </Card>
      <ApplicationReview session={session} applicationId={data.id} hideForbidden />
    </section>
  );
}

function BackToApplications({ bankSlug }: { bankSlug: string }) {
  return (
    <Link className={backLinkClassName} to={`/?bank=${encodeURIComponent(bankSlug)}`}>
      <ArrowLeft
        aria-hidden="true"
        className="size-4 transition-transform group-hover/back:-translate-x-0.5"
      />
      Your applications
    </Link>
  );
}

/** A titled sidebar panel on the borrower dashboard. */
function SidePanel({
  label,
  title,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  title: string;
  icon: typeof History;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn("rounded-xl border bg-card p-5 shadow-xs", className)}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

const quietLink =
  "inline-flex items-center gap-1 text-sm font-medium text-info underline-offset-4 hover:underline";

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
  const back = <BackToApplications bankSlug={session.bank.slug} />;
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
      <div className="space-y-5">
        {back}
        {detail.error && <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Application {data.id.slice(-8)}
            </p>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight break-words sm:text-[2rem]">
              {data.businessName ?? "Business application"}
            </h1>
          </div>
          {limited && <Badge variant="secondary">Limited access</Badge>}
        </div>
      </div>
      {["declined", "withdrawn"].includes(data.status) && (
        <Alert role="status" variant="warning">
          <AlertTitle>This application is closed</AlertTitle>
          <AlertDescription>{statusDescriptions[data.status]}</AlertDescription>
        </Alert>
      )}
      {!dashboard && (
        <Link to={path()} className={cn(backLinkClassName, "text-foreground")}>
          <ArrowLeft aria-hidden="true" className="size-4" />
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
          className="mb-6 rounded-xl border bg-card p-4 shadow-xs lg:hidden"
        >
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Current application
          </h2>
          <p className="mt-1.5 font-medium break-words">
            {data.businessName ?? "Business application"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <StatusPill tone={applicationStatusTone(data.status)}>
              {statusLabels[data.status]}
            </StatusPill>
            {!limited && data.requestedAmount && (
              <span className="font-semibold tabular-nums">
                {formatAmount(data.requestedAmount)}
              </span>
            )}
          </div>
        </section>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22.5rem)] xl:gap-8">
          <section aria-label="Application tasks" className="min-w-0 space-y-6">
            <ApplicationTasks
              session={session}
              applicationId={applicationId}
              businessName={data.businessName ?? "your business"}
              active={dashboard}
            />
            <section
              aria-label="Application actions"
              className="rounded-xl border bg-card shadow-xs"
            >
              <h2 className="border-b px-5 py-4 text-base font-semibold tracking-tight sm:px-6">
                Next steps
              </h2>
              <ul className="divide-y">
                {data.canReview && (
                  <ActionRow
                    icon={FilePenLine}
                    text={
                      data.status === "needs_information"
                        ? "Review the lender’s request, complete any returned tasks, then resubmit."
                        : "Review your application’s status and available submission actions."
                    }
                  >
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to={path("review")}
                    >
                      Review and submit application
                    </Link>
                  </ActionRow>
                )}
                <ActionRow
                  icon={FileSignature}
                  text="Open your permitted simulated signature requests."
                >
                  <Link to={path("signatures")} className={quietLink}>
                    View signatures
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </ActionRow>
                {data.canReview && ["approved", "closing", "funded"].includes(data.status) && (
                  <ActionRow
                    icon={ListChecks}
                    text={
                      data.status === "funded"
                        ? "Simulated funding is recorded for this application."
                        : "Complete remaining closing conditions and signatures."
                    }
                  >
                    <Link
                      to={path("closing")}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {data.status === "funded"
                        ? "View funded account"
                        : "View closing requirements"}
                    </Link>
                  </ActionRow>
                )}
              </ul>
            </section>
          </section>
          <aside aria-label="Application details" className="min-w-0 space-y-5">
            <Card className="gap-5">
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
                    <p className="text-[2rem] leading-tight font-semibold tracking-tight break-words tabular-nums">
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
                    <p className="text-xs font-medium text-muted-foreground">Funding purposes</p>
                    {data.fundingPurposes.length > 0 ? (
                      <ul aria-label="Funding purposes" className="mt-2 flex flex-wrap gap-1.5">
                        {data.fundingPurposes.map((id) => (
                          <li
                            key={id}
                            className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium"
                          >
                            {fundingPurposeOptions.find((option) => option.id === id)?.label ?? id}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words">{data.purpose}</p>
                    )}
                    {data.fundingPurposes.includes("other") && data.otherPurposeDetail && (
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {data.otherPurposeDetail}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Current stage</span>
                    <StatusPill tone={applicationStatusTone(data.status)}>
                      {statusLabels[data.status]}
                    </StatusPill>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {limited
                      ? "Your access is limited to assigned work and permitted information."
                      : statusDescriptions[data.status]}
                  </p>
                  {!limited && data.setupStatus === "completed" && (
                    <Badge variant="success">
                      <CircleCheck aria-hidden="true" data-icon="inline-start" />
                      Initial setup complete
                    </Badge>
                  )}
                </div>
                <ApplicationTimeline application={data} />
                <p className="text-xs text-muted-foreground">
                  Updated <UpdatedAt value={data.updatedAt} />
                </p>
              </CardContent>
            </Card>
            <details className="group/readiness rounded-xl border bg-card shadow-xs">
              <summary className="disclosure flex items-center justify-between gap-3 rounded-xl px-5 py-4 text-sm font-semibold hover:bg-muted/40">
                Task readiness
                <ChevronIcon />
              </summary>
              <div className="border-t px-5 py-4">
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
            <SidePanel label="Application contacts" title="Your loan officer" icon={Users}>
              {data.loanOfficer ? (
                <div className="flex items-center gap-3">
                  <IdentityAvatar email={data.loanOfficer.email} className="size-10" />
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="font-medium">{data.loanOfficer.displayName}</p>
                    <p className="break-all text-muted-foreground">{data.loanOfficer.email}</p>
                    <Badge variant="secondary">Synthetic contact</Badge>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  A loan officer has not been assigned yet.
                </p>
              )}
              <Link to={path("people")} className={quietLink}>
                People and access
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </SidePanel>
            <SidePanel label="Application history" title="History" icon={History}>
              <p className="text-sm text-muted-foreground">
                See the activity you have permission to view.
              </p>
              <Link to={path("activity")} className={quietLink}>
                View activity
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </SidePanel>
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

function ActionRow({
  icon: Icon,
  text,
  children,
}: {
  icon: typeof History;
  text: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="text-sm leading-6 text-muted-foreground">{text}</p>
      </div>
      <div className="shrink-0 pl-11 sm:pl-0">{children}</div>
    </li>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-muted-foreground transition-transform group-open/readiness:rotate-180"
    >
      <path
        d="m4 6 4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
