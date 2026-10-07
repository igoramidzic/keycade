import {
  type ApplicationSelection,
  applicationPageSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
  type PublicIntake,
  publicIntakeSchema,
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
import {
  type AuthenticatedSession,
  type Confirmation,
  type IdentityControls,
  IdentityPortal,
} from "@keycade/ui/components/identity-portal";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { ApiError, errorMessage, formatAmount, request } from "./api";
import { SetupWizard } from "./setup-wizard";
import { clearUnsavedAnswers } from "./unsaved-answers";

declare const __KEYCADE_PUBLIC__: { bankSiteUrl: string };
export const applicationPath = (id: string, bank: string, setup = false) =>
  `/applications/${id}${setup ? "/setup" : ""}?bank=${encodeURIComponent(bank)}`;
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>We couldn’t complete that step</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
function Loading() {
  return (
    <p role="status" className="py-10 text-center text-muted-foreground">
      Loading your application…
    </p>
  );
}

export function BorrowerApp({ confirmation }: { confirmation: Confirmation }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const bankSlug = params.get("bank") ?? "bank-a";
  // Product query hints no longer select financing; every new draft uses the server default.
  const productSlug = "business-credit";
  const starting = location.pathname === "/apply";
  const catalog = useQuery({
    queryKey: ["public-intake", bankSlug],
    queryFn: ({ signal }) =>
      request(`/api/v1/public/banks/${encodeURIComponent(bankSlug)}/intake`, publicIntakeSchema, {
        signal,
      }),
    retry: false,
  });
  const selected = catalog.data?.products.find((product) => product.slug === productSlug);
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <a href={__KEYCADE_PUBLIC__.bankSiteUrl} className="font-semibold">
            Keycade Bank
          </a>
          <span className="text-sm text-muted-foreground">Business financing</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
        {catalog.isPending ? (
          <Loading />
        ) : catalog.error ? (
          <ErrorNotice error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : (
          catalog.data &&
          (starting && !selected ? (
            <Card>
              <CardHeader>
                <CardTitle>Synthetic Business Credit is unavailable</CardTitle>
                <CardDescription>
                  Please try again later or continue an existing application.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link className={buttonVariants()} to={`/?bank=${encodeURIComponent(bankSlug)}`}>
                  Your applications
                </Link>
              </CardContent>
            </Card>
          ) : (
            <IdentityPortal
              portal="borrower"
              confirmation={confirmation}
              bankSlug={bankSlug}
              bankName={catalog.data.bank.name}
              intent={starting ? "start" : "resume"}
              onApplicationCreated={(id) =>
                navigate(applicationPath(id, bankSlug, true), { replace: true })
              }
              onSignedIn={() =>
                navigate(`/?bank=${encodeURIComponent(bankSlug)}`, { replace: true })
              }
              renderAuthenticated={(session, controls) => (
                <Workspace session={session} controls={controls} targetCatalog={catalog.data} />
              )}
            />
          ))
        )}
      </main>
      <footer className="border-t px-5 py-5 text-center text-xs leading-5 text-muted-foreground">
        Synthetic lending demo · Use fictional information only. No real credit decisions or money
        movement.
      </footer>
    </div>
  );
}
function Workspace({
  session,
  controls,
  targetCatalog,
}: {
  session: AuthenticatedSession;
  controls: IdentityControls;
  targetCatalog: PublicIntake;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const catalog = useQuery({
    queryKey: ["public-intake", session.bank.slug],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/public/banks/${encodeURIComponent(session.bank.slug)}/intake`,
        publicIntakeSchema,
        { signal },
      ),
    retry: false,
  });
  return (
    <div id="identity" className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{session.bank.name}</p>
          <p className="break-all text-sm text-muted-foreground">{session.user.email}</p>
          <Badge variant="secondary">
            {session.authenticationMethod === "demo" ? "Demo access" : "Email verified"}
          </Badge>
        </div>
        <Button
          variant="outline"
          disabled={controls.busy}
          onClick={async () => {
            if (!(await controls.signOut())) return;
            clearUnsavedAnswers();
            queryClient.clear();
            navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
      {controls.error && <ErrorNotice error={new ApiError("SIGN_OUT", 400, controls.error)} />}
      {catalog.isPending ? (
        <Loading />
      ) : catalog.error ? (
        <ErrorNotice error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : (
        catalog.data && (
          <Routes>
            <Route
              path="/apply"
              element={
                session.bank.id !== targetCatalog.bank.id ? (
                  <Alert>
                    <AlertTitle>You’re signed in to another bank</AlertTitle>
                    <AlertDescription>
                      Sign out to start an application at {targetCatalog.bank.name}.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <StartApplication
                    key={`${session.bank.id}:${session.user.email}`}
                    session={session}
                  />
                )
              }
            />
            <Route
              path="/applications/:applicationId/setup"
              element={<ApplicationRoute session={session} setup controls={controls} />}
            />
            <Route
              path="/applications/:applicationId"
              element={<ApplicationRoute session={session} controls={controls} />}
            />
            <Route
              path="/"
              element={
                <ApplicationList
                  session={session}
                  saved={Boolean((location.state as { saved?: boolean } | null)?.saved)}
                />
              }
            />
            <Route
              path="/auth/confirm"
              element={<Navigate replace to={`/?bank=${encodeURIComponent(session.bank.slug)}`} />}
            />
            <Route
              path="*"
              element={
                <Card>
                  <CardHeader>
                    <CardTitle>Page not found</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Link to="/" className={buttonVariants()}>
                      Your applications
                    </Link>
                  </CardContent>
                </Card>
              }
            />
          </Routes>
        )
      )}
    </div>
  );
}
function StartApplication({ session }: { session: AuthenticatedSession }) {
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const draft = await request(
        `/api/v1/banks/${session.bank.id}/applications`,
        applicationSetupSchema,
        {
          method: "POST",
          bankId: session.bank.id,
          actorEmail: session.user.email,
          body: { idempotencyKey: key.current },
        },
      );
      navigate(applicationPath(draft.id, session.bank.slug, true), { replace: true });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Start a new application</CardTitle>
        <CardDescription>
          We’ll ask a few simple questions. Your answers will be saved as you go.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm">
          Applying as {session.user.email}. Starting creates a separate application.
        </p>
        {Boolean(error) && <ErrorNotice error={error} />}
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : "Start application"}
          </Button>
          <Link
            className={buttonVariants({ variant: "outline" })}
            to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
          >
            Continue an existing application
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
function ApplicationList({ session, saved }: { session: AuthenticatedSession; saved: boolean }) {
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
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
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
  return (
    <section className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">You’re signed in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your applications</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Continue where you left off. Each application has its own saved setup.
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
      ) : list.error ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
            <CardDescription>Start your first application when you’re ready.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((application) => (
            <Card key={application.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{application.businessName ?? "New business application"}</CardTitle>
                  <Badge variant="outline">
                    {application.nextDestination === "closed"
                      ? "Closed"
                      : application.setupStatus === "completed"
                        ? "Setup complete"
                        : "Setup in progress"}
                  </Badge>
                </div>
                <CardDescription>
                  Reference {application.id.slice(0, 8)}
                  {application.requestedAmount
                    ? ` · ${formatAmount(application.requestedAmount)}`
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
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
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Show more applications
        </Button>
      )}
      <Link
        className={buttonVariants({ variant: "outline" })}
        to={`/apply?bank=${encodeURIComponent(session.bank.slug)}`}
      >
        Start a new application
      </Link>
    </section>
  );
}
function ApplicationRoute({
  session,
  setup = false,
  controls,
}: {
  session: AuthenticatedSession;
  setup?: boolean;
  controls: IdentityControls;
}) {
  const { applicationId = "" } = useParams();
  const destination = useQuery({
    queryKey: ["destination", session.bank.id, session.user.email, applicationId, setup],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/destination`,
        applicationSelectionSchema,
        { signal },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    gcTime: 0,
  });
  const data = destination.data;
  if (destination.isPending || destination.isFetching) return <Loading />;
  if (destination.error)
    return (
      <div className="space-y-4">
        <ErrorNotice error={destination.error} onRetry={() => void destination.refetch()} />
        <Link className={buttonVariants({ variant: "outline" })} to="/">
          Your applications
        </Link>
      </div>
    );
  if (!data) return null;
  if (data.nextDestination === "setup" && !setup)
    return <Navigate replace to={applicationPath(applicationId, session.bank.slug, true)} />;
  if (data.nextDestination === "portal" && setup)
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
  return (
    <section className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>
              {data.nextDestination === "closed"
                ? "This application is closed"
                : data.nextDestination === "assigned"
                  ? "Your assigned application"
                  : "Your setup is complete"}
            </h1>
          </CardTitle>
          <CardDescription>{data.businessName ?? "Business application"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6">
            {data.nextDestination === "closed"
              ? "You can return to your other applications or start a new one."
              : data.nextDestination === "assigned"
                ? "You have limited access to this application. Assigned tasks will appear here when available."
                : "Your initial answers are saved. Your application is collecting information; it has not been submitted or approved."}
          </p>
          {data.nextDestination === "portal" && (
            <p className="text-sm text-muted-foreground">
              Your task workspace will be available here in the next part of this demo.
            </p>
          )}
          {data.requestedAmount && (
            <p className="font-medium">Requested amount: {formatAmount(data.requestedAmount)}</p>
          )}
        </CardContent>
      </Card>
      <Link
        to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
        className={buttonVariants({ variant: "outline" })}
      >
        Your applications
      </Link>
    </section>
  );
}
