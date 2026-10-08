import "@keycade/ui/styles.css";
import { Badge } from "@keycade/ui/components/badge";
import { BrandMark } from "@keycade/ui/components/brand";
import { buttonVariants } from "@keycade/ui/components/button";
import { FundingPurposeIcon } from "@keycade/ui/components/funding-purpose-icon";
import { cn } from "@keycade/ui/lib/utils";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  FileCheck2,
  KeyRound,
  LayoutList,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare const __KEYCADE_PUBLIC__: { borrowerUrl: string; bankConsoleUrl: string };

const applyUrl = new URL("/apply", __KEYCADE_PUBLIC__.borrowerUrl);
applyUrl.searchParams.set("bank", "bank-a");
const resumeUrl = new URL("/", __KEYCADE_PUBLIC__.borrowerUrl);
resumeUrl.searchParams.set("bank", "bank-a");

const container = "mx-auto w-full max-w-6xl px-4 sm:px-8";

const uses = [
  { id: "working_capital", label: "Working capital", text: "Smooth seasonal cash flow." },
  { id: "equipment_purchase", label: "Equipment", text: "Machinery, vehicles and tools." },
  { id: "real_estate_purchase", label: "Real estate", text: "Buy the space you operate in." },
  { id: "business_acquisition", label: "Acquisitions", text: "Purchase or merge a business." },
  { id: "property_improvements", label: "Improvements", text: "Renovate and expand premises." },
  { id: "refinance_debt", label: "Refinancing", text: "Consolidate existing debt." },
  { id: "renewable_energy", label: "Renewable energy", text: "Solar, storage and efficiency." },
  { id: "construction", label: "Construction", text: "Build new facilities." },
] as const;

const steps = [
  {
    icon: MailCheck,
    title: "Start with your email",
    text: "No password to create. Your application is saved to your email so you can return any time.",
  },
  {
    icon: LayoutList,
    title: "Answer one question at a time",
    text: "Your business, its address, how much you need and what it’s for — each on its own simple screen.",
  },
  {
    icon: FileCheck2,
    title: "Complete your checklist",
    text: "Upload documents, answer follow-ups and sign from a single task dashboard built around what’s next.",
  },
  {
    icon: CircleCheck,
    title: "Track every stage",
    text: "Follow underwriting, your credit decision, closing and funding on a clear timeline.",
  },
] as const;

function BankSite() {
  return (
    <div className="flex min-h-screen flex-col bg-card text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-md">
        <div className={cn(container, "flex h-16 items-center justify-between gap-3")}>
          <a
            href="/"
            className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:gap-2.5"
          >
            <BrandMark className="size-7 sm:size-8" />
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight sm:text-[1.0625rem]">
              Synthetic Bank A
            </span>
          </a>
          <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-1">
            <a
              href="#business-financing"
              className={buttonVariants({ variant: "ghost", className: "hidden md:inline-flex" })}
            >
              Business financing
            </a>
            <a
              href="#how-it-works"
              className={buttonVariants({ variant: "ghost", className: "hidden md:inline-flex" })}
            >
              How it works
            </a>
            <a
              href={resumeUrl.href}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "ml-1 px-2.5 sm:px-3",
              })}
            >
              Continue an application
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section
          aria-labelledby="bank-introduction"
          className="relative overflow-hidden border-b border-border/70 bg-canvas"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_0%,color-mix(in_oklch,var(--brand)_14%,transparent),transparent_70%),radial-gradient(40%_60%_at_0%_100%,color-mix(in_oklch,var(--chart-2)_10%,transparent),transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:56px_56px] opacity-40 [mask-image:radial-gradient(70%_60%_at_70%_30%,black,transparent)]"
          />
          <div
            className={cn(
              container,
              "relative grid items-center gap-14 py-14 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:py-24",
            )}
          >
            <div className="min-w-0">
              <Badge variant="outline" className="h-7 gap-1.5 px-3 shadow-xs">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
                Fictional bank · Simulated lending
              </Badge>
              <h1
                id="bank-introduction"
                className="mt-6 max-w-xl text-[2.5rem] leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]"
              >
                A next step for your business.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-muted-foreground">
                Explore business financing with Synthetic Bank A. Start with your email, tell us a
                little about your business, and come back whenever you’re ready — your progress is
                saved along the way.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={applyUrl.href}
                  className={buttonVariants({
                    size: "lg",
                    className: "h-auto min-h-12 whitespace-normal py-3 shadow-md",
                  })}
                >
                  Apply for business financing
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </a>
                <a
                  href="#how-it-works"
                  className={buttonVariants({ variant: "ghost", size: "lg", className: "px-4" })}
                >
                  See how it works
                </a>
              </div>
              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
                {["No password needed", "Save and return anytime", "One question at a time"].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-2 whitespace-nowrap">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
                      </span>
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <ApplicationPreview />
          </div>
        </section>

        <section
          id="business-financing"
          aria-labelledby="financing-title"
          className="scroll-mt-16 py-20 sm:py-24"
        >
          <div className={cn(container, "grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16")}>
            <div className="max-w-md">
              <p className="eyebrow text-brand">Business financing</p>
              <h2
                id="financing-title"
                className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
              >
                Synthetic Business Credit
              </h2>
              <p className="mt-5 text-base leading-7 text-pretty text-muted-foreground">
                One flexible credit product for growing businesses. Tell us what the funds are for
                and how much you need — a loan officer works alongside you from application through
                funding.
              </p>
              <dl className="mt-8 grid gap-4 sm:grid-cols-2">
                <Highlight icon={KeyRound} title="Passwordless access">
                  Secure one-time links or instant demo sign-in.
                </Highlight>
                <Highlight icon={ShieldCheck} title="Private documents">
                  Uploads stay within your application.
                </Highlight>
              </dl>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground">
                What businesses use it for
              </h3>
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {uses.map((use) => (
                  <li
                    key={use.id}
                    className="group flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-brand/30 hover:bg-brand-soft/40"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:text-brand">
                      <FundingPurposeIcon id={use.id} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{use.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {use.text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-title"
          className="scroll-mt-16 border-y border-border/70 bg-canvas py-20 sm:py-24"
        >
          <div className={container}>
            <div className="max-w-2xl">
              <p className="eyebrow text-brand">How it works</p>
              <h2
                id="how-title"
                className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
              >
                Business credit, one step at a time
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">
                A guided application that respects your time. Pause whenever you need to and pick up
                exactly where you left off.
              </p>
            </div>
            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li
                  key={step.title}
                  className="relative flex flex-col rounded-xl border border-border bg-card p-6 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <step.icon aria-hidden="true" className="size-5" />
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-sm font-semibold text-muted-foreground tabular-nums"
                    >
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="ready-title" className="py-20 sm:py-24">
          <div className={container}>
            <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-primary-foreground shadow-lg sm:px-12 sm:py-14">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,white_22%,transparent),transparent)]"
              />
              <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                <div className="max-w-xl">
                  <h2
                    id="ready-title"
                    className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl"
                  >
                    Ready when you are.
                  </h2>
                  <p className="mt-3 text-base leading-7 text-primary-foreground/80">
                    A few simple questions to get started. No password needed — and you can pause
                    and return along the way.
                  </p>
                </div>
                <a
                  href={applyUrl.href}
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className:
                      "shrink-0 border-transparent bg-card text-foreground hover:border-transparent hover:bg-card/90",
                  })}
                >
                  Start your application
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 bg-canvas">
        <div
          className={cn(
            container,
            "flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between",
          )}
        >
          <div className="max-w-md space-y-3">
            <p className="flex items-center gap-2 font-semibold tracking-tight">
              <BrandMark className="size-6" />
              Synthetic Bank A
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              A fictional bank for the Keycade demo. Use synthetic information only. This is a
              simulated lending experience; no real credit decision or transfer of money takes
              place.
            </p>
          </div>
          <a
            href={__KEYCADE_PUBLIC__.bankConsoleUrl}
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Bank staff sign-in
          </a>
        </div>
      </footer>
    </div>
  );
}

function Highlight({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  children: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <dt className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="size-4 text-brand" />
        {title}
      </dt>
      <dd className="mt-1.5 text-xs leading-5 text-muted-foreground">{children}</dd>
    </div>
  );
}

/** A decorative illustration of the borrower dashboard; it carries no information or controls. */
function ApplicationPreview() {
  const stages = [
    { label: "Initial application", state: "done" },
    { label: "Application in progress", state: "current" },
    { label: "Underwriting", state: "next" },
    { label: "Credit decision", state: "next" },
    { label: "Closing and funding", state: "next" },
  ] as const;
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md select-none lg:mx-0">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-lg sm:pb-16">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Requested amount</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">$250,000</p>
          </div>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-xs font-medium text-brand">
            <span className="size-1.5 rounded-full bg-brand" />
            In progress
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {["Equipment purchase", "Working capital"].map((purpose) => (
            <span
              key={purpose}
              className="rounded-full border border-border bg-canvas px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {purpose}
            </span>
          ))}
        </div>
        <div className="mt-6 border-t pt-5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Application progress
          </p>
          <ol className="mt-4 space-y-3.5">
            {stages.map((stage, index) => (
              <li key={stage.label} className="relative flex items-center gap-3 text-sm">
                {index < stages.length - 1 && (
                  <span
                    className={cn(
                      "absolute top-6 left-[11px] h-[calc(100%-6px)] w-px",
                      stage.state === "done" ? "bg-success/50" : "bg-border",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative flex size-6 shrink-0 items-center justify-center rounded-full border",
                    stage.state === "done" && "border-success bg-success text-white",
                    stage.state === "current" && "border-brand bg-brand-soft",
                    stage.state === "next" && "border-border bg-card",
                  )}
                >
                  {stage.state === "done" ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : stage.state === "current" ? (
                    <span className="size-2 rounded-full bg-brand" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    stage.state === "next" ? "text-muted-foreground" : "font-medium",
                    stage.state === "current" && "text-foreground",
                  )}
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="absolute -bottom-7 -left-4 hidden w-64 rounded-xl border border-border bg-card p-4 shadow-md sm:block lg:-left-10">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-success-soft text-success">
            <FileCheck2 className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Business tax return</p>
            <p className="text-xs text-muted-foreground">Uploaded · Ready for review</p>
          </div>
        </div>
      </div>
      <div className="absolute -top-5 -right-3 hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md sm:flex">
        <Clock3 className="size-3.5 text-brand" />2 tasks need your action
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");

createRoot(root).render(
  <StrictMode>
    <BankSite />
  </StrictMode>,
);
