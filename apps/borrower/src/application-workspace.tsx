import {
  type ApplicationSelection,
  applicationPageSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
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
import type {
  AuthenticatedSession,
  IdentityControls,
} from "@keycade/ui/components/identity-portal";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ApiError, formatAmount, request } from "./api";
import { ApplicationPeople } from "./participants";
import { SetupWizard } from "./setup-wizard";
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
  funded:
    "Funding has been recorded for this application. Account details are not available in this demo yet.",
  withdrawn: "This application was withdrawn. You can return to your other applications.",
};
const setupSteps: Record<ApplicationSelection["currentStep"], string> = {
  business_name: "Business name",
  product: "Requested amount",
  amount: "Requested amount",
  purpose: "Loan purpose",
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
        <Card>
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
                {applications.map((application) => (
                  <article key={application.id} aria-label={`Application ${application.id}`}>
                    <Card>
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
                          variant={application.nextDestination === "closed" ? "outline" : "default"}
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
      <section aria-label="Funded accounts" className="border-t pt-5">
        <h2 className="font-semibold">Funded accounts</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Funded account details are not available in this demo yet.
        </p>
      </section>
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
  const destination = useQuery({
    queryKey: ["destination", session.bank.id, session.user.email, applicationId, setup],
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
  const back = (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
    >
      Your applications
    </Link>
  );
  if (destination.isPending || destination.isFetching) return <Loading />;
  if (destination.error)
    return (
      <div className="space-y-4">
        <ErrorNotice error={destination.error} onRetry={() => void destination.refetch()} />
        {back}
      </div>
    );
  if (!data) return null;
  if (data.nextDestination === "setup" && !setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug, true)} />;
  if (data.nextDestination !== "setup" && setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug)} />;
  if (data.nextDestination === "setup")
    return (
      <SetupWizard
        key={`${session.bank.id}:${session.user.email}:${applicationId}`}
        session={session}
        applicationId={applicationId}
        refreshSession={controls.refreshSession}
      />
    );
  if (data.nextDestination === "closed")
    return <ClosedApplication data={data} bankSlug={session.bank.slug} />;
  return (
    <ApplicationPortal
      key={`${session.bank.id}:${session.user.email}:${applicationId}`}
      session={session}
      applicationId={applicationId}
      view={view}
    />
  );
}

function ClosedApplication({ data, bankSlug }: { data: ApplicationSelection; bankSlug: string }) {
  const back = (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={`/?bank=${encodeURIComponent(bankSlug)}`}
    >
      Your applications
    </Link>
  );
  return (
    <section className="space-y-5">
      {back}
      <Card>
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
    </section>
  );
}

const views = ["Overview", "Tasks", "Documents", "People", "Activity"] as const;
const emptyViews = {
  tasks: [
    "Tasks are not available yet",
    "Task requests are not enabled in this demo yet. Your initial setup is saved; finishing it does not complete or submit your application.",
  ],
  documents: [
    "Documents are not available yet",
    "Document uploads are not enabled in this demo yet. No documents have been requested through this workspace.",
  ],
  activity: [
    "Activity is not available yet",
    "An application activity feed is not enabled in this demo yet.",
  ],
} as const;
function ApplicationPortal({
  session,
  applicationId,
  view,
}: {
  session: AuthenticatedSession;
  applicationId: string;
  view: string;
}) {
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
  const path = (section = "") =>
    `/applications/${applicationId}${section ? `/${section}` : ""}?bank=${encodeURIComponent(session.bank.slug)}`;
  const back = (
    <Link
      className={buttonVariants({ variant: "outline" })}
      to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
    >
      Your applications
    </Link>
  );
  if (detail.isPending || !detail.isFetchedAfterMount) return <Loading />;
  if (detail.error) {
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
  if (data.nextDestination === "closed")
    return <ClosedApplication data={data} bankSlug={session.bank.slug} />;
  const limited = data.accessScope === "assigned";
  const active = view || "overview";
  const empty = emptyViews[active as keyof typeof emptyViews];
  return (
    <section className="space-y-6">
      {back}
      <header className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{statusLabels[data.status]}</Badge>
          {limited && <Badge variant="secondary">Limited access</Badge>}
        </div>
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {data.businessName ?? "Business application"}
        </h1>
        <p className="text-sm text-muted-foreground">Application {data.id.slice(-8)}</p>
      </header>
      <nav aria-label="Application sections" className="flex flex-wrap gap-1 border-b pb-3">
        {views.map((label) => {
          const key = label.toLowerCase();
          return (
            <Link
              key={key}
              to={path(key === "overview" ? "" : key)}
              aria-current={active === key ? "page" : undefined}
              className={buttonVariants({
                variant: active === key ? "secondary" : "ghost",
                size: "sm",
              })}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {active === "overview" ? (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Overview</h2>
              </CardTitle>
              <CardDescription>
                {limited
                  ? "Your access is limited to assigned work and permitted information."
                  : statusDescriptions[data.status]}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!limited && data.setupStatus === "completed" && (
                <Badge variant="secondary">Initial setup complete</Badge>
              )}
              <Summary application={data} />
              {!limited && data.purpose && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Loan purpose</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{data.purpose}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{limited ? "Your assigned work" : "Next steps"}</h2>
              </CardTitle>
              <CardDescription>
                {limited
                  ? "Assigned tasks will appear here when available. You do not need to complete the applicant’s setup."
                  : "Review the Tasks section for remaining work. Task requests are not enabled in this demo yet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to={path("tasks")} className={buttonVariants()}>
                View tasks
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : active === "people" ? (
        <ApplicationPeople session={session} applicationId={applicationId} />
      ) : empty ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{views.find((label) => label.toLowerCase() === active)}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <h3 className="font-medium">{empty[0]}</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {limited
                ? "Only your explicitly permitted information will appear here. This feature is not enabled in the demo yet."
                : empty[1]}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Page not found</h2>
            </CardTitle>
            <CardDescription>Choose an application section above.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </section>
  );
}
