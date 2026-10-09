import { staffOptionsSchema } from "@keycade/contracts";
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
import { DemoKitProvider, useDemoUploadAvailability } from "@keycade/ui/components/demo-kit";
import { EmptyState } from "@keycade/ui/components/empty-state";
import {
  type AuthenticatedSession,
  type Confirmation,
  type IdentityControls,
  IdentityPortal,
} from "@keycade/ui/components/identity-portal";
import { cn } from "@keycade/ui/lib/utils";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BarChart3,
  Briefcase,
  CheckCircle2,
  FileQuestion,
  Inbox,
  LogOut,
  Scale,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ApiError, createStaffApi, StaffApiContext } from "./api";
import { StaffDemoInbox } from "./demo-inbox";
import { ApplicationDetail } from "./detail";
import { CreateApplication } from "./forms";
import { ApplicationQueue } from "./queue";
import { ErrorNotice, Loading } from "./ui";

export function BankApp({ confirmation }: { confirmation: Confirmation }) {
  const location = useLocation();
  const navigate = useNavigate();
  const header = useHeaderSlot();
  const [showKit, setShowKit] = useState(false);
  const bankSlug = new URLSearchParams(location.search).get("bank") ?? "bank-a";
  return (
    <DemoKitProvider visible={showKit}>
      <div className="flex min-h-screen flex-col bg-canvas text-foreground">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <AppHeader
          slotRef={header.ref}
          brand={
            <Link
              to={`/?bank=${encodeURIComponent(bankSlug)}`}
              className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <BrandLockup name="Keycade Bank Console" detail="Staff workspace" />
            </Link>
          }
        />
        <HeaderSlotProvider slot={header.slot}>
          <main id="main" className={cn(shellWidth, "flex-1 py-8 sm:py-10")}>
            <IdentityPortal
              key={bankSlug}
              portal="staff"
              confirmation={confirmation}
              bankSlug={bankSlug}
              aside={<StaffWelcome />}
              onSignedIn={(path) =>
                navigate(
                  `${path === "/demo-inbox" ? path : "/"}?bank=${encodeURIComponent(bankSlug)}`,
                  { replace: true },
                )
              }
              renderAuthenticated={(session, controls) => (
                <Workspace
                  key={`${session.bank.id}:${session.user.email}:${session.authenticationMethod}`}
                  session={session}
                  controls={controls}
                  showKit={setShowKit}
                />
              )}
            />
          </main>
        </HeaderSlotProvider>
        <AppFooter>
          <p>Keycade · Business lending</p>
        </AppFooter>
      </div>
    </DemoKitProvider>
  );
}

function StaffWelcome() {
  const points = [
    {
      icon: Briefcase,
      title: "One queue for every application",
      text: "Search, filter and pick up drafts and submitted applications across your bank.",
    },
    {
      icon: BarChart3,
      title: "Reviewed financials and evidence",
      text: "Business profile, financial history and documents side by side.",
    },
    {
      icon: Scale,
      title: "Guarded decisions",
      text: "Human review, closing and funding with a full audit trail.",
    },
  ];
  return (
    <div className="max-w-xl">
      <p className="eyebrow text-brand">Bank staff</p>
      <p className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        Every application, clearly laid out.
      </p>
      <p className="mt-4 text-base leading-7 text-pretty text-muted-foreground">
        Review what each borrower has provided, what’s outstanding and what needs your decision.
      </p>
      <ul className="mt-8 space-y-5">
        {points.map((point) => (
          <li key={point.title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card text-brand shadow-xs">
              <point.icon aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{workflowText(point.title)}</span>
              <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">
                {point.text}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
        Bank membership is verified separately from borrower access.
      </p>
    </div>
  );
}
function Workspace({
  session,
  controls,
  showKit,
}: {
  session: AuthenticatedSession;
  controls: IdentityControls;
  showKit: (visible: boolean) => void;
}) {
  useEffect(() => {
    showKit(true);
    return () => showKit(false);
  }, [showKit]);
  // A private cache belongs to this mounted identity only and is discarded on sign-out.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } },
      }),
  );
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState(false);
  useDemoUploadAvailability(!checking && !denied);
  const [checkError, setCheckError] = useState<unknown>(null);
  const onDenied = useCallback(() => {
    setDenied(true);
    setCheckError(
      new ApiError(
        "STAFF_RECHECK",
        401,
        "Your staff session changed. Check access again to continue.",
      ),
    );
    client.clear();
    void controlsRef.current.refreshSession().catch(setCheckError);
  }, [client]);
  const api = useMemo(() => createStaffApi(session, onDenied), [session, onDenied]);
  const verify = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await api.request("/options", staffOptionsSchema);
      setDenied(false);
      setChecking(false);
    } catch (error) {
      setCheckError(error);
    }
  }, [api]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible") void verify();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") setChecking(true);
      else void verify();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      client.clear();
    };
  }, [client, verify]);
  const navigate = useNavigate();
  return (
    <QueryClientProvider client={client}>
      <StaffApiContext.Provider value={api}>
        <HeaderPortal>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 max-sm:w-full max-sm:justify-between sm:justify-end">
            <div className="flex min-w-0 items-center gap-2.5 sm:order-last sm:border-l sm:pl-3">
              <IdentityAvatar email={session.user.email} />
              <div className="min-w-0 space-y-0.5">
                <p className="max-w-[16rem] truncate text-xs font-medium">{session.user.email}</p>
                <Badge variant="secondary" className="h-5">
                  {session.authenticationMethod === "demo" ? "Staff access" : "Email verified"}
                </Badge>
              </div>
            </div>
            {session.demoInboxEnabled && (
              <Link
                to={`/demo-inbox?bank=${encodeURIComponent(session.bank.slug)}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <Inbox aria-hidden="true" />
                Inbox
              </Link>
            )}
            <Button
              variant="outline"
              size="sm"
              className="sm:order-last"
              disabled={controls.busy}
              onClick={async () => {
                if (await controls.signOut()) {
                  client.clear();
                  navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { replace: true });
                }
              }}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </HeaderPortal>
        {controls.error && (
          <p role="alert" className="mb-5 text-sm text-destructive">
            {controls.error}
          </p>
        )}
        {(checking || denied) &&
          (checkError ? (
            <ErrorNotice error={checkError} onRetry={() => void verify()} />
          ) : (
            <Loading>Checking staff access…</Loading>
          ))}
        <div hidden={checking || denied}>
          <Routes>
            <Route path="/demo-inbox" element={<StaffDemoInbox />} />
            <Route path="/" element={<ApplicationQueue />} />
            <Route path="/applications/new" element={<CreateApplication />} />
            <Route path="/applications/:applicationId/*" element={<ApplicationDetail />} />
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
                      Back to applications
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </div>
      </StaffApiContext.Provider>
    </QueryClientProvider>
  );
}
