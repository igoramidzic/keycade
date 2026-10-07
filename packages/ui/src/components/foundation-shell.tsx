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
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  CircleDashed,
  ExternalLink,
  Landmark,
  Layers3,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AppName = "bank-site" | "borrower" | "bank-console";
type CheckState = "checking" | "available" | "unavailable";

declare const __KEYCADE_PUBLIC__: {
  bankSiteUrl: string;
  borrowerUrl: string;
  bankConsoleUrl: string;
};

const applications = {
  "bank-site": {
    name: "Keycade Bank",
    label: "Mock bank site",
    eyebrow: "The beginning of the journey",
    title: "A place for businesses to move forward.",
    description:
      "The public entry point for Keycade’s business lending experience. Explore the connected workspaces while the local foundation is ready to test.",
    next: "Email-first applications and product information will arrive in the next milestone.",
    icon: Landmark,
    url: () => __KEYCADE_PUBLIC__.bankSiteUrl,
  },
  borrower: {
    name: "Borrower Portal",
    label: "Borrower workspace",
    eyebrow: "Your business, in one place",
    title: "Room for your next chapter.",
    description:
      "The future home for your businesses, applications, and requested documents. This workspace currently demonstrates the shared interface and local service connection.",
    next: "Passwordless access, saved applications, and document requests will arrive in later milestones.",
    icon: Building2,
    url: () => __KEYCADE_PUBLIC__.borrowerUrl,
  },
  "bank-console": {
    name: "Bank Console",
    label: "Staff workspace",
    eyebrow: "A clear view of what’s next",
    title: "A workspace built around progress.",
    description:
      "The future home for the bank’s application queue, reviews, and decisions. Start by checking the local services and exploring the connected applications.",
    next: "Staff authentication, application queues, and review tools will arrive in later milestones.",
    icon: Layers3,
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

export function FoundationShell({ app }: { app: AppName }) {
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
          <Badge variant="secondary">Local foundation</Badge>
          <span className="text-xs text-muted-foreground">Development preview</span>
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
              <a href="#workspaces" className={buttonVariants()}>
                Explore workspaces <ArrowRight aria-hidden="true" />
              </a>
              <a href="#services" className={buttonVariants({ variant: "outline" })}>
                Check services
              </a>
            </div>
          </section>

          <Card id="services">
            <CardHeader>
              <CardTitle>Local service connection</CardTitle>
              <CardDescription>Live checks from this workspace to the API.</CardDescription>
            </CardHeader>
            <CardContent>
              <div aria-live="polite" aria-atomic="true" className="divide-y border-y">
                <ServiceStatus label="API health" state={checks.api} />
                <ServiceStatus label="API readiness" state={checks.ready} />
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                {checking
                  ? "Checking your local development services."
                  : checks.api === "available" && checks.ready === "available"
                    ? "The API is responding and its readiness checks have passed."
                    : "A service is unavailable. Check the development terminal, then try again."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-5"
                disabled={checking}
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden="true" className={checking ? "animate-spin" : undefined} />
                {checking ? "Checking…" : "Refresh checks"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <section
          id="workspaces"
          aria-labelledby="workspaces-heading"
          className="mt-16 border-t pt-10 lg:mt-24"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="workspaces-heading" className="text-lg font-semibold tracking-tight">
                Three connected workspaces
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A shared foundation for the whole lending journey.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              Synthetic data · Simulated providers
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {(Object.entries(applications) as [AppName, (typeof applications)[AppName]][]).map(
              ([key, item]) => {
                const Icon = item.icon;
                return (
                  <Card key={key}>
                    <CardHeader>
                      <div className="mb-3 flex items-center justify-between">
                        <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                        {key === app && <Badge variant="outline">You are here</Badge>}
                      </div>
                      <CardTitle>{item.name}</CardTitle>
                      <CardDescription>{item.next}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <a
                        href={item.url()}
                        className="inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
                      >
                        Open workspace <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </CardContent>
                  </Card>
                );
              },
            )}
          </div>
        </section>

        <p className="mt-8 rounded-lg border bg-muted/40 px-5 py-4 text-sm leading-6 text-muted-foreground">
          This is a local development preview. Lending forms and account access are not available
          yet. Future checks and funding in this prototype will be clearly marked simulations.
        </p>
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
