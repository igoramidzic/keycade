import "@keycade/ui/styles.css";
import { Badge } from "@keycade/ui/components/badge";
import { buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare const __KEYCADE_PUBLIC__: { borrowerUrl: string; bankConsoleUrl: string };

const applyUrl = new URL("/apply", __KEYCADE_PUBLIC__.borrowerUrl);
applyUrl.searchParams.set("bank", "bank-a");
applyUrl.searchParams.set("product", "business-credit");
const resumeUrl = new URL("/", __KEYCADE_PUBLIC__.borrowerUrl);
resumeUrl.searchParams.set("bank", "bank-a");

function BankSite() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/" className="text-lg font-semibold tracking-tight">
            Synthetic Bank A
          </a>
          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-3">
            <a
              href="#business-financing"
              className={buttonVariants({ variant: "ghost", className: "px-0 sm:px-2.5" })}
            >
              Business financing
            </a>
            <a
              href={resumeUrl.href}
              className={buttonVariants({ variant: "outline", className: "h-auto py-2" })}
            >
              Continue an application
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-20">
        <div className="grid items-start gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
          <section aria-labelledby="bank-introduction">
            <Badge variant="secondary">Fictional bank · Simulated lending</Badge>
            <h1
              id="bank-introduction"
              className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              A next step for your business.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Explore a business financing application with Synthetic Bank A. Start with your email,
              tell us a little about your business, and come back whenever you’re ready.
            </p>
            <div className="mt-8">
              <a
                href={applyUrl.href}
                className={buttonVariants({
                  size: "lg",
                  className: "h-auto whitespace-normal py-3",
                })}
              >
                Apply for business financing
              </a>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              A few simple questions to get started. No password needed.
            </p>
          </section>

          <Card id="business-financing">
            <CardHeader>
              <CardTitle>Business credit, one step at a time</CardTitle>
              <CardDescription>
                Try the application journey with a fictional lending product.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <ol className="space-y-5 text-sm leading-6">
                <li>
                  <p className="font-medium">1. Start with your email</p>
                  <p className="text-muted-foreground">Get access to your saved application.</p>
                </li>
                <li>
                  <p className="font-medium">2. Tell us about your plans</p>
                  <p className="text-muted-foreground">
                    Answer one question at a time about your business and financing needs.
                  </p>
                </li>
                <li>
                  <p className="font-medium">3. Review and finish setup</p>
                  <p className="text-muted-foreground">
                    Check your answers before entering your application workspace. You can pause and
                    return along the way.
                  </p>
                </li>
              </ol>
              <p className="border-t pt-5 text-xs leading-5 text-muted-foreground">
                Use synthetic information only. This is a simulated lending experience; no real
                credit decision or transfer of money takes place.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span>Synthetic Bank A · A fictional bank for the Keycade demo</span>
          <a
            href={__KEYCADE_PUBLIC__.bankConsoleUrl}
            className="rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Bank staff sign-in
          </a>
        </div>
      </footer>
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
