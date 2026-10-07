import { staffOptionsSchema } from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  type AuthenticatedSession,
  type Confirmation,
  type IdentityControls,
  IdentityPortal,
} from "@keycade/ui/components/identity-portal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ApiError, createStaffApi, StaffApiContext } from "./api";
import { ApplicationDetail } from "./detail";
import { CreateApplication } from "./forms";
import { ApplicationQueue } from "./queue";
import { ErrorNotice, Loading } from "./ui";

export function BankApp({ confirmation }: { confirmation: Confirmation }) {
  const location = useLocation();
  const navigate = useNavigate();
  const bankSlug = new URLSearchParams(location.search).get("bank") ?? "bank-a";
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
          <Link
            to={`/?bank=${encodeURIComponent(bankSlug)}`}
            className="font-semibold tracking-tight"
          >
            Keycade Bank Console
          </Link>
          <Badge variant="secondary">Staff workspace</Badge>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        <IdentityPortal
          portal="staff"
          confirmation={confirmation}
          bankSlug={bankSlug}
          onSignedIn={() => navigate(`/?bank=${encodeURIComponent(bankSlug)}`, { replace: true })}
          renderAuthenticated={(session, controls) => (
            <Workspace
              key={`${session.bank.id}:${session.user.email}:${session.authenticationMethod}`}
              session={session}
              controls={controls}
            />
          )}
        />
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
}: {
  session: AuthenticatedSession;
  controls: IdentityControls;
}) {
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
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div className="space-y-1">
            <p className="font-medium">{session.bank.name}</p>
            <p className="break-all text-sm text-muted-foreground">{session.user.email}</p>
            <Badge variant="secondary">
              {session.authenticationMethod === "demo"
                ? "Demo access · email unverified"
                : "Email verified"}
            </Badge>
          </div>
          <Button
            variant="outline"
            disabled={controls.busy}
            onClick={async () => {
              if (await controls.signOut()) {
                client.clear();
                navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { replace: true });
              }
            }}
          >
            Sign out
          </Button>
        </div>
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
                <>
                  <h1 className="text-2xl font-semibold">Page not found</h1>
                  <Link to="/" className="mt-4 inline-block underline">
                    Back to applications
                  </Link>
                </>
              }
            />
          </Routes>
        </div>
      </StaffApiContext.Provider>
    </QueryClientProvider>
  );
}
