import { applicationSetupSchema, type PublicIntake, publicIntakeSchema } from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import {
  AppFooter,
  AppHeader,
  HeaderPortal,
  HeaderSlotProvider,
  IdentityAvatar,
  shellWidth,
  useHeaderSlot,
} from "@keycade/ui/components/app-shell";
import { Badge } from "@keycade/ui/components/badge";
import { BrandLockup } from "@keycade/ui/components/brand";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import { EmptyState, LoadingState } from "@keycade/ui/components/empty-state";
import {
  type AuthenticatedSession,
  type Confirmation,
  type IdentityControls,
  IdentityPortal,
} from "@keycade/ui/components/identity-portal";
import { cn } from "@keycade/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  FileQuestion,
  Inbox,
  LayoutList,
  LogOut,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ApiError, request } from "./api";
import { ApplicationList, ApplicationRoute } from "./application-workspace";
import { BorrowerDemoInbox } from "./demo-inbox";
import { InvitationAcceptance } from "./participants";
import { ReminderPreferences } from "./reminder-preferences";
import { SignatureContinuation } from "./signatures";
import { clearUnsavedAnswers } from "./unsaved-answers";
import { applicationPath, ErrorNotice } from "./workspace-ui";

declare const __KEYCADE_PUBLIC__: { bankSiteUrl: string };

export function BorrowerApp({ confirmation }: { confirmation: Confirmation }) {
  const location = useLocation();
  const navigate = useNavigate();
  const header = useHeaderSlot();
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
    // The identity root spans the header so signed-in account controls stay inside it.
    <div id="identity" className="flex min-h-screen flex-col bg-canvas text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <AppHeader
        slotRef={header.ref}
        brand={
          <a
            href={__KEYCADE_PUBLIC__.bankSiteUrl}
            className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <BrandLockup name="Keycade Bank" detail="Business financing" />
          </a>
        }
      />
      <HeaderSlotProvider slot={header.slot}>
        <main id="main" className={cn(shellWidth, "flex-1 py-8 sm:py-10")}>
          {catalog.isPending ? (
            <LoadingState>Loading your application…</LoadingState>
          ) : catalog.error ? (
            <ErrorNotice error={catalog.error} onRetry={() => void catalog.refetch()} />
          ) : (
            catalog.data &&
            (starting && !selected ? (
              <EmptyState
                titleAs="h1"
                icon={FileQuestion}
                title="Synthetic Business Credit is unavailable"
                description="Please try again later or continue an existing application."
                action={
                  <Link className={buttonVariants()} to={`/?bank=${encodeURIComponent(bankSlug)}`}>
                    Your applications
                  </Link>
                }
              />
            ) : (
              <IdentityPortal
                portal="borrower"
                cardId="sign-in"
                confirmation={confirmation}
                bankSlug={bankSlug}
                bankName={catalog.data.bank.name}
                intent={starting ? "start" : "resume"}
                returnPath={location.pathname}
                aside={<SignInWelcome starting={starting} bankName={catalog.data.bank.name} />}
                onApplicationCreated={(id) =>
                  navigate(applicationPath(id, bankSlug, true), { replace: true })
                }
                onSignedIn={(returnPath) =>
                  navigate(
                    returnPath === "/demo-inbox" ||
                      (returnPath &&
                        /^\/(?:invitations|signatures|applications)\/[0-9a-f-]{36}(?:\/setup)?$/i.test(
                          returnPath,
                        ))
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
      </HeaderSlotProvider>
      <AppFooter />
    </div>
  );
}

function SignInWelcome({ starting, bankName }: { starting: boolean; bankName: string }) {
  const points = starting
    ? [
        {
          icon: MailCheck,
          title: "Start with just your email",
          text: "No password to create. We save your application as you go.",
        },
        {
          icon: LayoutList,
          title: "A few simple questions",
          text: "One question per screen about your business and financing needs.",
        },
        {
          icon: ShieldCheck,
          title: "Review before you finish",
          text: "Check every answer, then continue to your application checklist.",
        },
      ]
    : [
        {
          icon: LayoutList,
          title: "Pick up where you left off",
          text: "Unfinished setup returns you to your saved question.",
        },
        {
          icon: Check,
          title: "See what’s next",
          text: "Your task dashboard shows what needs your attention first.",
        },
        {
          icon: ShieldCheck,
          title: "Private by design",
          text: "Each application keeps its own documents and progress.",
        },
      ];
  return (
    <div className="max-w-xl">
      <p className="eyebrow text-brand">{bankName}</p>
      <p className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        {starting ? "Business financing, one step at a time." : "Welcome back."}
      </p>
      <p className="mt-4 text-base leading-7 text-pretty text-muted-foreground">
        {starting
          ? "Tell us a little about your business. You can pause at any point and return to the same question later."
          : "Sign in to open your saved applications, complete remaining tasks and follow your progress."}
      </p>
      <ul className="mt-8 space-y-5">
        {points.map((point) => (
          <li key={point.title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card text-brand shadow-xs">
              <point.icon aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{point.title}</span>
              <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">
                {point.text}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccountControls({
  session,
  controls,
  onSignOut,
}: {
  session: AuthenticatedSession;
  controls: IdentityControls;
  onSignOut: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 max-sm:w-full max-sm:justify-between sm:justify-end">
      <div className="flex min-w-0 items-center gap-2.5 sm:order-last sm:border-l sm:pl-3">
        <IdentityAvatar email={session.user.email} />
        <div className="min-w-0 space-y-0.5">
          <p className="max-w-[15rem] truncate text-xs font-medium">{session.user.email}</p>
          <Badge variant="secondary" className="h-5">
            {session.authenticationMethod === "demo" ? "Demo access" : "Email verified"}
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:contents">
        {session.demoInboxEnabled && (
          <Link
            to={`/demo-inbox?bank=${encodeURIComponent(session.bank.slug)}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <Inbox aria-hidden="true" />
            Demo inbox
          </Link>
        )}
        <ReminderPreferences key={`${session.bank.id}:${session.user.email}`} session={session} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="sm:order-last"
        disabled={controls.busy}
        onClick={onSignOut}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
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
    <div className="space-y-6">
      <HeaderPortal>
        <AccountControls
          session={session}
          controls={controls}
          onSignOut={async () => {
            if (!(await controls.signOut())) return;
            clearUnsavedAnswers();
            queryClient.clear();
            navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { replace: true });
          }}
        />
      </HeaderPortal>
      {controls.error && <ErrorNotice error={new ApiError("SIGN_OUT", 400, controls.error)} />}
      {catalog.isPending ? (
        <LoadingState>Loading your application…</LoadingState>
      ) : catalog.error ? (
        <ErrorNotice error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : (
        catalog.data && (
          <Routes>
            <Route
              path="/demo-inbox"
              element={
                <BorrowerDemoInbox
                  key={`${session.bank.id}:${session.user.email}`}
                  session={session}
                />
              }
            />
            <Route
              path="/signatures/:envelopeId"
              element={<SignatureContinuation session={session} />}
            />
            <Route
              path="/invitations/:invitationId"
              element={<InvitationAcceptance session={session} />}
            />
            <Route
              path="/apply"
              element={
                session.bank.id !== targetCatalog.bank.id ? (
                  <Alert variant="warning">
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
                <EmptyState
                  titleAs="h1"
                  icon={FileQuestion}
                  title="Page not found"
                  action={
                    <Link to="/" className={buttonVariants()}>
                      Your applications
                    </Link>
                  }
                />
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
    <section className="mx-auto w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-md sm:p-10">
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <LayoutList aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
        Start a new application
      </h1>
      <p className="mt-2 text-base leading-7 text-muted-foreground">
        We’ll ask a few simple questions. Your answers will be saved as you go.
      </p>
      <p className="mt-6 rounded-lg bg-muted/70 px-4 py-3 text-sm">
        Applying as <span className="font-medium break-all">{session.user.email}</span>. Starting
        creates a separate application.
      </p>
      {Boolean(error) && (
        <div className="mt-5">
          <ErrorNotice error={error} />
        </div>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start application"}
          {!busy && <ArrowRight aria-hidden="true" data-icon="inline-end" />}
        </Button>
        <Link
          className={buttonVariants({ variant: "outline", size: "lg" })}
          to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
        >
          Continue an existing application
        </Link>
      </div>
    </section>
  );
}
