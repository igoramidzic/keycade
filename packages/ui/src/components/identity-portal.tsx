import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { Input } from "@keycade/ui/components/input";
import { rememberSession } from "@keycade/ui/lib/session-snapshot";
import { cn } from "cn";
import {
  Check,
  CircleAlert,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailCheck,
  ShieldAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

declare const __KEYCADE_PUBLIC__: { hosted: boolean; mailpitUrl: string | null };

export type Confirmation = { page: boolean; token: string | null };
// The app captures each email link once before mounting. Remember when that capture
// has been handled so a cache-driven unmount cannot revive a consumed credential.
const handledConfirmations = new WeakSet<Confirmation>();

// Capture once, before React mounts: StrictMode may run state initializers twice.
// Credentials remain only in memory and are removed from browser history immediately.
export function captureConfirmation(): Confirmation {
  const page = window.location.pathname === "/auth/confirm";
  if (!page) return { page: false, token: null };
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  const bankSlug = new URLSearchParams(window.location.search).get("bank");
  const bankQuery =
    bankSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bankSlug)
      ? `?bank=${encodeURIComponent(bankSlug)}`
      : "";
  window.history.replaceState(null, "", `/auth/confirm${bankQuery}`);
  return { page: true, token };
}

type Session = { demoSignInEnabled: boolean; demoInboxEnabled?: boolean } & (
  | { authenticated: false }
  | {
      authenticated: true;
      user: { email: string; displayName: string | null };
      csrfToken: string;
      bank: { id: string; slug: string; name: string };
      staff: boolean;
      authenticationMethod: "demo" | "email_link";
    }
);
export type AuthenticatedSession = Extract<Session, { authenticated: true }>;
export type IdentityControls = {
  signOut: () => Promise<boolean>;
  refreshSession: () => Promise<void>;
  busy: boolean;
  error: string | null;
};
type Screen =
  | "loading"
  | "request"
  | "inbox"
  | "confirm"
  | "expired"
  | "signed-in"
  | "denied"
  | "unavailable";

async function fetchSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch("/api/v1/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Session unavailable");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("authenticated" in result)) {
    throw new Error("Session unavailable");
  }
  const session = result as Session;
  if (!signal?.aborted) rememberSession(session);
  return session;
}

export function IdentityPortal({
  portal,
  confirmation,
  bankSlug = "bank-a",
  bankName = "Synthetic Bank A",
  intent = "resume",
  returnPath = "/",
  onApplicationCreated,
  onSignedIn,
  renderAuthenticated,
  cardId = "identity",
  aside,
}: {
  portal: "borrower" | "staff";
  confirmation?: Confirmation;
  bankSlug?: string;
  bankName?: string;
  intent?: "start" | "resume";
  returnPath?: string;
  onApplicationCreated?: (id: string) => void;
  onSignedIn?: (returnPath?: string) => void;
  renderAuthenticated?: (session: AuthenticatedSession, controls: IdentityControls) => ReactNode;
  /** Element id for the sign-in card. */
  cardId?: string;
  /** Optional welcome content shown beside the card on signed-out screens. */
  aside?: ReactNode;
}) {
  const initialConfirmation =
    confirmation && !handledConfirmations.has(confirmation) ? confirmation : undefined;
  const credential = useRef(initialConfirmation?.token ?? null);
  const confirmationPending = useRef(initialConfirmation?.page ?? false);
  const [screen, setScreen] = useState<Screen>("loading");
  const [session, setSession] = useState<Session>({
    authenticated: false,
    demoSignInEnabled: false,
  });
  const [email, setEmail] = useState("");
  const [emailLinkMode, setEmailLinkMode] = useState(initialConfirmation?.page ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeAfterStart, setResumeAfterStart] = useState(false);
  const startKey = useRef<{ payload: string; key: string } | null>(null);
  const createKey = useRef<{ payload: string; key: string } | null>(null);
  const isStaff = portal === "staff";
  const isStarting = !isStaff && intent === "start" && !resumeAfterStart;
  const useDemo = session.demoSignInEnabled && !emailLinkMode;
  function clearConfirmation() {
    credential.current = null;
    confirmationPending.current = false;
    if (confirmation) handledConfirmations.add(confirmation);
  }

  const loadSession = useCallback(
    async (signal?: AbortSignal, showConfirmation = false) => {
      const next = await fetchSession(signal);
      if (signal?.aborted) return;
      setSession(next);
      if (showConfirmation && confirmationPending.current) {
        setScreen(credential.current ? "confirm" : "expired");
      } else if (!next.authenticated) {
        setScreen("request");
      } else if (isStaff) {
        // A protected server endpoint verifies active bank membership independently.
        const proof = await fetch("/api/v1/auth/staff", {
          credentials: "same-origin",
          cache: "no-store",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        });
        if (signal?.aborted) return;
        if (proof.status === 401) {
          setSession({
            authenticated: false,
            demoSignInEnabled: next.demoSignInEnabled,
            demoInboxEnabled: next.demoInboxEnabled,
          });
          setScreen("request");
        } else if (proof.status === 403 || proof.status === 404) {
          setScreen("denied");
        } else if (!proof.ok) {
          throw new Error("Staff access unavailable");
        } else {
          setScreen("signed-in");
        }
      } else {
        setScreen("signed-in");
      }
    },
    [isStaff],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal, true).catch(() => {
      if (!controller.signal.aborted) setScreen("unavailable");
    });
    return () => controller.abort();
  }, [loadSession]);

  async function post(
    path: string,
    body: object,
    expectedActor?: { bankId: string; email: string },
  ) {
    // Another tab may have refreshed or revoked this browser's session since mount.
    const current = await fetchSession();
    if (
      expectedActor &&
      (!current.authenticated ||
        current.bank.id !== expectedActor.bankId ||
        current.user.email !== expectedActor.email)
    ) {
      throw new Error("Your sign-in changed. Please try again.");
    }
    return fetch(path.startsWith("/") ? path : `/api/v1/auth/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(current.authenticated ? { "x-csrf-token": current.csrfToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let response: Response;
      if (isStarting && !useDemo) {
        const payload = JSON.stringify({
          email: email.trim().toLowerCase(),
          bankSlug,
        });
        if (startKey.current?.payload !== payload) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          startKey.current = {
            payload,
            key: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
          };
        }
        response = await post("/api/v1/applications/start", {
          email,
          bankSlug,
          idempotencyKey: startKey.current.key,
        });
      } else {
        response = await post(useDemo ? "demo-sign-in" : "request-link", {
          email,
          bankSlug,
          portal,
          returnPath:
            /^\/(?:invitations|signatures|applications)\/[0-9a-f-]{36}(?:\/setup)?$/i.test(
              returnPath,
            )
              ? returnPath
              : "/",
        });
      }
      if (response.status === 429) {
        setError("Too many requests. Please wait a few minutes before trying again.");
      } else if (useDemo && response.status === 503) {
        setError("Sign-in is temporarily unavailable. Please try again in a moment.");
      } else if (useDemo && [403, 404].includes(response.status)) {
        setError(
          isStaff
            ? "This email can’t access this staff demo. Use your bank staff email address."
            : "We couldn’t sign you in to this demo. Please check your email and try again.",
        );
      } else if (!response.ok) {
        setError(
          useDemo
            ? "We couldn’t sign you in to this demo. Please try again."
            : "We couldn’t request your link. Check your email address and try again.",
        );
      } else if (useDemo) {
        if (isStarting) {
          const current = await fetchSession();
          if (
            !current.authenticated ||
            current.bank.slug !== bankSlug ||
            current.user.email !== email.trim().toLowerCase()
          ) {
            setError(
              "We couldn’t confirm access to this bank. Your email is still here; try again.",
            );
            return;
          }
          const payload = JSON.stringify({
            email: current.user.email,
            bankId: current.bank.id,
          });
          if (createKey.current?.payload !== payload) {
            createKey.current = { payload, key: crypto.randomUUID() };
          }
          const created = await post(
            `/api/v1/banks/${current.bank.id}/applications`,
            {
              idempotencyKey: createKey.current.key,
            },
            { bankId: current.bank.id, email: current.user.email },
          );
          if (!created.ok) {
            setError("We couldn’t start your application. Your email is still here; try again.");
            return;
          }
          const draft: unknown = await created.json();
          if (
            !draft ||
            typeof draft !== "object" ||
            !("id" in draft) ||
            typeof draft.id !== "string"
          ) {
            throw new Error("Application unavailable");
          }
          onApplicationCreated?.(draft.id);
        }
        clearConfirmation();
        if (!renderAuthenticated) window.history.replaceState(null, "", "/");
        await loadSession().catch(() => setScreen("unavailable"));
      } else {
        setScreen("inbox");
      }
    } catch {
      setError("We couldn’t connect. Your email address is still here; please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openDemoInbox() {
    setBusy(true);
    setError(null);
    try {
      const response = await post("demo-sign-in", { email, bankSlug, portal, returnPath: "/" });
      if (!response.ok) throw new Error("Demo inbox unavailable.");
      clearConfirmation();
      await loadSession();
      if (renderAuthenticated) onSignedIn?.("/demo-inbox");
      else window.location.assign(`/demo-inbox?bank=${encodeURIComponent(bankSlug)}`);
    } catch {
      setError("This demo inbox is unavailable for this account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmLink() {
    if (!credential.current) return setScreen("expired");
    setBusy(true);
    setError(null);
    try {
      const response = await post("consume", { token: credential.current });
      if (response.status === 429) {
        setError("Too many attempts. Please wait a few minutes before trying again.");
      } else if (response.status === 403) {
        setError("We couldn’t verify this request. Please try again.");
      } else if ([400, 401, 409, 410].includes(response.status)) {
        clearConfirmation();
        setScreen("expired");
      } else if (!response.ok) {
        setError("We couldn’t confirm your link. Please try again.");
      } else {
        const result: unknown = await response.json();
        const requestedPath =
          result && typeof result === "object" && "returnPath" in result ? result.returnPath : "/";
        const returnPath =
          typeof requestedPath === "string" &&
          /^\/(?:invitations|signatures|applications)\/[0-9a-f-]{36}(?:\/setup)?$/i.test(
            requestedPath,
          )
            ? requestedPath
            : "/";
        clearConfirmation();
        if (renderAuthenticated) onSignedIn?.(returnPath);
        else window.history.replaceState(null, "", returnPath);
        await loadSession().catch(() => setScreen("unavailable"));
      }
    } catch {
      setError("We couldn’t connect. Try again, or request a fresh link if it was already used.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      const response = await post("logout", {});
      if (!response.ok && response.status !== 401) {
        setError("We couldn’t sign you out. Please try again.");
        return false;
      }
      clearConfirmation();
      startKey.current = null;
      createKey.current = null;
      rememberSession({ authenticated: false });
      setSession({
        authenticated: false,
        demoSignInEnabled: session.demoSignInEnabled,
        demoInboxEnabled: session.demoInboxEnabled,
      });
      setEmail("");
      setEmailLinkMode(false);
      setResumeAfterStart(false);
      setScreen("request");
      if (!renderAuthenticated) window.history.replaceState(null, "", "/");
      return true;
    } catch {
      setError("We couldn’t connect to sign you out. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    clearConfirmation();
    setError(null);
    setEmailLinkMode(true);
    // Once a public start was acknowledged, a fresh link is generic resume and must
    // neither create another application nor rely on the original browser key.
    if (screen === "inbox" && isStarting) setResumeAfterStart(true);
    setScreen("request");
    if (!renderAuthenticated) window.history.replaceState(null, "", "/");
  }

  if (screen === "signed-in" && session.authenticated && renderAuthenticated) {
    return renderAuthenticated(session, {
      signOut: logout,
      refreshSession: () => loadSession(),
      busy,
      error,
    });
  }

  const titles: Record<Screen, string> = {
    loading: "Checking your session…",
    request: isStaff
      ? "Sign in to the bank console"
      : isStarting
        ? "Start with your email"
        : "Continue your application",
    inbox: "Check your inbox",
    confirm: "Confirm your sign-in",
    expired: "This link can’t be used",
    "signed-in": isStaff ? "You’re signed in to the bank console" : "You’re signed in",
    denied: "Staff access is required",
    unavailable: "Sign-in is temporarily unavailable",
  };

  const ScreenIcon =
    screen === "inbox"
      ? MailCheck
      : screen === "denied" || screen === "expired" || screen === "unavailable"
        ? ShieldAlert
        : LockKeyhole;
  const card = (
    <Card id={cardId} className="mx-auto h-fit w-full max-w-lg shadow-md">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-info">
            <ScreenIcon aria-hidden="true" className="size-4.5" />
          </span>
          <span className="text-sm font-medium text-foreground">{bankName}</span>
          <Badge variant="outline">Demo</Badge>
        </div>
        <CardTitle className="pt-1 text-2xl font-semibold tracking-tight" aria-live="polite">
          {titles[screen]}
        </CardTitle>
        <CardDescription className="text-pretty">
          {useDemo
            ? isStaff
              ? "Enter a seeded staff email to open the local demo immediately. Bank membership is still required."
              : isStarting
                ? "Enter a synthetic email to start your application. No password or inbox visit needed."
                : "Enter a synthetic email to continue the local demo immediately. No password or email confirmation needed."
            : isStaff
              ? "Use your bank staff email address. Your bank membership is checked when you sign in."
              : isStarting
                ? "We’ll save your application and email a one-time link so you can continue. You don’t need a password."
                : "Get a one-time email link. You don’t need a password."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {screen === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Checking access…
          </p>
        )}
        {screen === "request" && (
          <form onSubmit={(event) => void signIn(event)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="sign-in-email" className="text-sm font-medium">
                Email address
              </label>
              <Input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.test"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                aria-describedby="email-help"
                className="h-11"
              />
              <p id="email-help" className="text-xs leading-5 text-muted-foreground">
                {isStarting
                  ? "Use synthetic information only. You can save your progress and return later."
                  : "Requesting access won’t start a new application."}
              </p>
            </div>
            <Button loading={busy} type="submit" size="lg" disabled={busy} className="w-full">
              {useDemo ? <LockKeyhole aria-hidden="true" /> : <Mail aria-hidden="true" />}
              {isStarting ? "Start application" : useDemo ? "Sign in to demo" : "Send sign-in link"}
            </Button>
            {session.demoSignInEnabled && (
              <Button
                type="button"
                variant="link"
                disabled={busy}
                className="h-auto w-full whitespace-normal py-1"
                onClick={() => {
                  setEmailLinkMode(!emailLinkMode);
                  setError(null);
                }}
              >
                {emailLinkMode ? "Use immediate demo sign-in instead" : "Use an email link instead"}
              </Button>
            )}
          </form>
        )}
        {screen === "inbox" && (
          <div className="space-y-4">
            <p className="text-sm leading-6">
              {session.demoInboxEnabled
                ? "Your simulated message will appear in the demo inbox. Open it and confirm to continue. No email is sent externally."
                : "If this address can sign in, a link will arrive shortly. Open the email and confirm to continue."}
            </p>
            <p className="flex items-center gap-2.5 rounded-lg border bg-muted/60 px-3 py-2.5 text-sm font-medium break-all">
              <Mail aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {email}
            </p>
            {session.demoInboxEnabled && (
              <Button
                loading={busy}
                size="lg"
                disabled={busy}
                className="w-full"
                onClick={() => void openDemoInbox()}
              >
                <Inbox aria-hidden="true" />
                Open demo inbox
              </Button>
            )}

            <p className="text-xs leading-5 text-muted-foreground">
              Delivery can take a few seconds. You can request a fresh link if yours expires.
            </p>
            <Button
              variant="outline"
              className="h-auto w-full whitespace-normal py-2.5"
              onClick={startAgain}
            >
              {isStarting
                ? "Request a fresh sign-in link"
                : "Use another email or request a new link"}
            </Button>
          </div>
        )}
        {screen === "confirm" && (
          <div className="space-y-4">
            <p className="text-sm leading-6">
              Continue only if you requested this email. Confirming signs you in on this browser and
              uses the link once.
            </p>
            <Button
              loading={busy}
              size="lg"
              onClick={() => void confirmLink()}
              disabled={busy}
              className="w-full"
            >
              Confirm and sign in
            </Button>
          </div>
        )}
        {screen === "expired" && (
          <div className="space-y-4">
            <p className="text-sm leading-6">
              The link may have expired, already been used, or be unavailable for this workspace.
              Request a fresh link to continue.
            </p>
            <Button onClick={startAgain}>Request a new link</Button>
          </div>
        )}
        {(screen === "signed-in" || screen === "denied") && session.authenticated && (
          <div className="space-y-4">
            <div
              className={cn(
                "rounded-lg border p-4",
                screen === "denied" ? "border-warning/25 bg-warning-soft" : "bg-muted/50",
              )}
            >
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                {screen === "signed-in" ? (
                  <Check aria-hidden="true" className="size-4 text-success" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-4 text-warning" />
                )}
                {screen === "signed-in"
                  ? session.authenticationMethod === "demo"
                    ? "Demo access"
                    : "Email verified"
                  : "Bank membership not found"}
              </p>
              <p className="break-all text-sm">{session.user.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">{session.bank.name}</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {screen === "denied"
                ? "This account does not have staff access to this bank. Sign out and use your bank staff email address."
                : isStaff
                  ? "Your staff access is confirmed. The application queue and review tools will be available in a later milestone."
                  : "Your portal access is ready. Application forms and saved application workspaces will be available in a later milestone."}
            </p>
            {session.authenticationMethod === "demo" && (
              <p className="text-xs leading-5 text-muted-foreground">
                This session uses demo access. It does not verify ownership of the email address.
              </p>
            )}
            <Button loading={busy} variant="outline" onClick={() => void logout()} disabled={busy}>
              Sign out
            </Button>
          </div>
        )}
        {screen === "unavailable" && (
          <div className="space-y-4">
            <p className="text-sm leading-6">
              We couldn’t check your session. Please try again in a moment.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setScreen("loading");
                void loadSession(undefined, true).catch(() => setScreen("unavailable"));
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm leading-6 text-danger"
          >
            {error}
          </p>
        )}
        {!__KEYCADE_PUBLIC__.hosted && (
          <div className="space-y-1.5 rounded-lg bg-muted/70 px-4 py-3 text-xs leading-5 text-muted-foreground">
            <p>
              Synthetic demo email:{" "}
              <span className="break-all font-medium text-foreground">
                {isStaff ? "officer-a@example.test" : "borrower@example.test"}
              </span>
            </p>
            <p>
              {useDemo
                ? "Demo sign-in needs no inbox visit. Use synthetic information only."
                : "Emails are delivered to the local inbox only. Use synthetic information."}
            </p>
            {!useDemo && __KEYCADE_PUBLIC__.mailpitUrl && (
              <a
                href={__KEYCADE_PUBLIC__.mailpitUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "link", size: "sm", className: "h-auto p-0" })}
              >
                Open local inbox
              </a>
            )}
          </div>
        )}
        {__KEYCADE_PUBLIC__.hosted && (
          <p className="rounded-lg bg-muted/70 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Email sign-in is available in the local development demo. Hosted email delivery is not
            configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
  if (!aside) return card;
  return (
    <div className="grid w-full items-center gap-10 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-16 lg:py-8">
      <div className="order-2 min-w-0 lg:order-1">{aside}</div>
      <div className="order-1 min-w-0 lg:order-2">{card}</div>
    </div>
  );
}
