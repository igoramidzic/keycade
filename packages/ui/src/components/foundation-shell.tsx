import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { type Confirmation, IdentityPortal } from "@keycade/ui/components/identity-portal";
import { ArrowRight, Check, CircleAlert, CircleDashed, Landmark, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AppName = "bank-site" | "borrower" | "bank-console";
type CheckState = "checking" | "available" | "unavailable";

declare const __KEYCADE_PUBLIC__: {
  bankSiteUrl: string;
  borrowerUrl: string;
  bankConsoleUrl: string;
  hosted: boolean;
};

const applications = {
  "bank-site": {
    name: "Keycade Bank",
    label: "Mock bank site",
    eyebrow: "The beginning of the journey",
    title: "A place for businesses to move forward.",
    description:
      "The public entry point for Keycade’s business lending experience. Sign in to the borrower portal to try the demo.",
    url: () => __KEYCADE_PUBLIC__.bankSiteUrl,
  },
  borrower: {
    name: "Borrower Portal",
    label: "Borrower workspace",
    eyebrow: "Your business, in one place",
    title: "Room for your next chapter.",
    description:
      "Enter a synthetic email to open the local borrower demo immediately. You can also test the one-time email link flow.",
    url: () => __KEYCADE_PUBLIC__.borrowerUrl,
  },
  "bank-console": {
    name: "Bank Console",
    label: "Staff workspace",
    eyebrow: "A clear view of what’s next",
    title: "A workspace built around progress.",
    description:
      "Sign in with your bank staff email to access the console. Your membership is checked independently from borrower access.",
    url: () => __KEYCADE_PUBLIC__.bankConsoleUrl,
  },
} satisfies Record<AppName, object>;

async function checkEndpoint(path: string, signal: AbortSignal): Promise<CheckState> {
  try {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok) return "unavailable";
    const data: unknown = await response.json();
    return typeof data === "object" &&
      data !== null &&
      "status" in data &&
      (data.status === "ok" || data.status === "ready")
      ? "available"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function ServiceStatus({ label, state }: { label: string; state: CheckState }) {
  const Icon = state === "checking" ? CircleDashed : state === "available" ? Check : CircleAlert;
  const text =
    state === "checking" ? "Checking…" : state === "available" ? "Connected" : "Unavailable";

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={`size-4 ${state === "checking" ? "animate-spin" : ""}`}
        />
        {text}
      </span>
    </div>
  );
}

export function FoundationShell({
  app,
  confirmation,
}: {
  app: AppName;
  confirmation?: Confirmation;
}) {
  const current = applications[app];
  const [checks, setChecks] = useState<{ api: CheckState; ready: CheckState }>({
    api: "checking",
    ready: "checking",
  });
  const activeRequest = useRef<AbortController | null>(null);
  const checking = checks.api === "checking" || checks.ready === "checking";

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setChecks({ api: "checking", ready: "checking" });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
    const [api, ready] = await Promise.all([
      checkEndpoint("/api/health", signal),
      checkEndpoint("/api/ready", signal),
    ]);
    if (!controller.signal.aborted) setChecks({ api, ready });
  }, []);

  useEffect(() => {
    void refresh();
    return () => activeRequest.current?.abort();
  }, [refresh]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
          <a href={current.url()} className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Landmark aria-hidden="true" className="size-5" />
            </span>
            <span>{current.name}</span>
          </a>
          <nav aria-label="Applications" className="flex flex-wrap items-center gap-1">
            {(Object.entries(applications) as [AppName, (typeof applications)[AppName]][]).map(
              ([key, item]) => (
                <a
                  key={key}
                  href={item.url()}
                  aria-current={key === app ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    key === app ? "bg-muted font-medium" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 lg:px-8 lg:py-20">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Badge variant="secondary">
            {app === "bank-site"
              ? __KEYCADE_PUBLIC__.hosted
                ? "Demo foundation"
                : "Local foundation"
              : "Demo access"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {__KEYCADE_PUBLIC__.hosted ? "Hosted preview" : "Development preview"}
          </span>
        </div>
        <div className="grid items-start gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-20">
          <section>
            <p className="mb-4 text-sm font-medium text-muted-foreground">{current.eyebrow}</p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.12]">
              {current.title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              {current.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={app === "bank-site" ? __KEYCADE_PUBLIC__.borrowerUrl : "#identity"}
                className={buttonVariants()}
              >
                {app === "bank-site" ? "Open borrower portal" : "Continue to sign in"}{" "}
                <ArrowRight aria-hidden="true" />
              </a>
              <a href="#services" className={buttonVariants({ variant: "outline" })}>
                Check services
              </a>
            </div>
          </section>

          <div className="min-w-0 space-y-6">
            {app !== "bank-site" && (
              <IdentityPortal
                portal={app === "borrower" ? "borrower" : "staff"}
                confirmation={confirmation}
              />
            )}
            <Card id="services">
              <CardHeader>
                <CardTitle>Service connection</CardTitle>
                <CardDescription>Live checks from this workspace to the API.</CardDescription>
              </CardHeader>
              <CardContent>
                <div aria-live="polite" aria-atomic="true" className="divide-y border-y">
                  <ServiceStatus label="API health" state={checks.api} />
                  <ServiceStatus label="API readiness" state={checks.ready} />
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  {checking
                    ? "Checking the connected services."
                    : checks.api === "available" && checks.ready === "available"
                      ? "The API is responding and its readiness checks have passed."
                      : "A service is unavailable. Try refreshing the checks in a moment."}
                </p>
                <Button
                  loading={checking}
                  variant="outline"
                  size="sm"
                  className="mt-5"
                  disabled={checking}
                  onClick={() => void refresh()}
                >
                  <RefreshCw aria-hidden="true" />
                  Refresh checks
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-xs text-muted-foreground lg:px-8">
          <span>Keycade · Local development</span>
          <span>Applications through funding</span>
        </div>
      </footer>
    </div>
  );
}
