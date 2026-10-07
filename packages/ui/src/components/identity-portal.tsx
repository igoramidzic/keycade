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
import { Check, CircleAlert, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

declare const __KEYCADE_PUBLIC__: { hosted: boolean; mailpitUrl: string | null };

export type Confirmation = { page: boolean; token: string | null };

// Capture once, before React mounts: StrictMode may run state initializers twice.
// Credentials remain only in memory and are removed from browser history immediately.
export function captureConfirmation(): Confirmation {
  const page = window.location.pathname === "/auth/confirm";
  if (!page) return { page: false, token: null };
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState(null, "", "/auth/confirm");
  return { page: true, token };
}

type Session = { demoSignInEnabled: boolean } & (
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
  return result as Session;
}

export function IdentityPortal({
  portal,
  confirmation,
}: {
  portal: "borrower" | "staff";
  confirmation?: Confirmation;
}) {
  const credential = useRef(confirmation?.token ?? null);
  const confirmationPending = useRef(confirmation?.page ?? false);
  const [screen, setScreen] = useState<Screen>("loading");
  const [session, setSession] = useState<Session>({
    authenticated: false,
    demoSignInEnabled: false,
  });
  const [email, setEmail] = useState("");
  const [emailLinkMode, setEmailLinkMode] = useState(confirmation?.page ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStaff = portal === "staff";
  const useDemo = session.demoSignInEnabled && !emailLinkMode;

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
          setSession({ authenticated: false, demoSignInEnabled: next.demoSignInEnabled });
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

  async function post(path: string, body: object) {
    // Another tab may have refreshed or revoked this browser's session since mount.
    const current = await fetchSession();
    return fetch(`/api/v1/auth/${path}`, {
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
      const response = await post(useDemo ? "demo-sign-in" : "request-link", {
        email,
        bankSlug: "bank-a",
        portal,
        returnPath: "/",
      });
      if (response.status === 429) {
        setError("Too many requests. Please wait a few minutes before trying again.");
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
        credential.current = null;
        confirmationPending.current = false;
        window.history.replaceState(null, "", "/");
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
        credential.current = null;
        setScreen("expired");
      } else if (!response.ok) {
        setError("We couldn’t confirm your link. Please try again.");
      } else {
        credential.current = null;
        confirmationPending.current = false;
        // Only the approved internal destination is supported in this milestone.
        window.history.replaceState(null, "", "/");
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
        return;
      }
      credential.current = null;
      confirmationPending.current = false;
      setSession({ authenticated: false, demoSignInEnabled: session.demoSignInEnabled });
      setEmail("");
      setEmailLinkMode(false);
      setScreen("request");
      window.history.replaceState(null, "", "/");
    } catch {
      setError("We couldn’t connect to sign you out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    credential.current = null;
    confirmationPending.current = false;
    setError(null);
    setEmailLinkMode(true);
    setScreen("request");
    window.history.replaceState(null, "", "/");
  }

  const titles: Record<Screen, string> = {
    loading: "Checking your session…",
    request: isStaff ? "Sign in to the bank console" : "Sign in to your borrower portal",
    inbox: "Check your inbox",
    confirm: "Confirm your sign-in",
    expired: "This link can’t be used",
    "signed-in": isStaff ? "You’re signed in to the bank console" : "You’re signed in",
    denied: "Staff access is required",
    unavailable: "Sign-in is temporarily unavailable",
  };

  return (
    <Card id="identity" className="h-fit">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="size-5" />
          <span className="text-sm">Synthetic Bank A</span>
          <Badge variant="outline">Demo</Badge>
        </div>
        <CardTitle className="text-xl" aria-live="polite">
          {titles[screen]}
        </CardTitle>
        <CardDescription>
          {useDemo
            ? isStaff
              ? "Enter a seeded staff email to open the local demo immediately. Bank membership is still required."
              : "Enter a synthetic email to open the local demo immediately. No password or email confirmation needed."
            : isStaff
              ? "Use your bank staff email address. Your bank membership is checked when you sign in."
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
              />
              <p id="email-help" className="text-xs leading-5 text-muted-foreground">
                Requesting access won’t start a new application.
              </p>
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {useDemo ? <LockKeyhole aria-hidden="true" /> : <Mail aria-hidden="true" />}
              {useDemo
                ? busy
                  ? "Signing in…"
                  : "Sign in to demo"
                : busy
                  ? "Requesting link…"
                  : "Send sign-in link"}
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
              If this address can sign in, a link will arrive shortly. Open the email and confirm to
              continue.
            </p>
            <p className="break-all text-sm font-medium">{email}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Delivery can take a few seconds. You can request a fresh link if yours expires.
            </p>
            <Button
              variant="outline"
              className="h-auto w-full whitespace-normal py-2"
              onClick={startAgain}
            >
              Use another email or request a new link
            </Button>
          </div>
        )}
        {screen === "confirm" && (
          <div className="space-y-4">
            <p className="text-sm leading-6">
              Continue only if you requested this email. Confirming signs you in on this browser and
              uses the link once.
            </p>
            <Button onClick={() => void confirmLink()} disabled={busy} className="w-full">
              {busy ? "Confirming…" : "Confirm and sign in"}
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
            <div className="rounded-lg border p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                {screen === "signed-in" ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-4" />
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
            <Button variant="outline" onClick={() => void logout()} disabled={busy}>
              {busy ? "Signing out…" : "Sign out"}
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
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
          >
            {error}
          </p>
        )}
        {!__KEYCADE_PUBLIC__.hosted && (
          <div className="space-y-2 border-t pt-4 text-xs leading-5 text-muted-foreground">
            <p>
              Synthetic demo email:{" "}
              <span className="break-all font-medium">
                {isStaff ? "officer-a@example.test" : "borrower@example.test"}
              </span>
            </p>
            <p>
              {useDemo
                ? "Demo sign-in opens the portal immediately. Use synthetic information only."
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
          <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
            Email sign-in is available in the local development demo. Hosted email delivery is not
            configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
