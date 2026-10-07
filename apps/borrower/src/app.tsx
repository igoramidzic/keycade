import { applicationSetupSchema, type PublicIntake, publicIntakeSchema } from "@keycade/contracts";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ApiError, request } from "./api";
import { ApplicationList, ApplicationRoute } from "./application-workspace";
import { InvitationAcceptance } from "./participants";
import { clearUnsavedAnswers } from "./unsaved-answers";
import { applicationPath, ErrorNotice, Loading } from "./workspace-ui";

declare const __KEYCADE_PUBLIC__: { bankSiteUrl: string };

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
    <div className="flex min-h-screen flex-col bg-muted text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="bg-card">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <a href={__KEYCADE_PUBLIC__.bankSiteUrl} className="font-semibold">
            Keycade Bank
          </a>
          <span className="text-sm text-muted-foreground">Business financing</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-6 sm:px-8 sm:py-8">
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
              returnPath={location.pathname}
              onApplicationCreated={(id) =>
                navigate(applicationPath(id, bankSlug, true), { replace: true })
              }
              onSignedIn={(returnPath) =>
                navigate(
                  returnPath?.startsWith("/invitations/")
                    ? `${returnPath}?bank=${encodeURIComponent(bankSlug)}`
                    : `/?bank=${encodeURIComponent(bankSlug)}`,
                  { replace: true },
                )
              }
              renderAuthenticated={(session, controls) => (
                <Workspace session={session} controls={controls} targetCatalog={catalog.data} />
              )}
            />
          ))
        )}
      </main>
      <footer className="px-5 py-6 text-center text-xs leading-5 text-muted-foreground">
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
    <div id="identity" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
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
              path="/invitations/:invitationId"
              element={<InvitationAcceptance session={session} />}
            />
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
              path="/applications/:applicationId/*"
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
    <Card className="mx-auto w-full max-w-3xl">
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
