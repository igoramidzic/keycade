import {
  type ApplicationSetup,
  type ApplicationSetupStep,
  applicationSetupSchema,
  type PublicIntake,
  type SaveApplicationSetup,
  saveApplicationSetupSchema,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@keycade/ui/components/native-select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { ApiError, decimalAmount, errorMessage, formatAmount, request } from "./api";
import { applicationPath, ErrorNotice } from "./app";
import { answerKey, rememberAnswer, unsavedAnswer } from "./unsaved-answers";

// Bounded synthetic fixture until T15 adds the industry lookup adapter.
const industries = [
  ["23", "Construction"],
  ["31", "Manufacturing"],
  ["44", "Retail trade"],
  ["54", "Professional and technical services"],
  ["72", "Accommodation and food services"],
] as const;
const questions = {
  business_name: {
    title: "What is your business called?",
    label: "Business name",
    help: "Use the business name you would put on an application.",
  },
  product: {
    title: "Which financing product fits your business?",
    label: "Financing product",
    help: "Choose from this bank’s available financing products.",
  },
  amount: {
    title: "How much would you like to borrow?",
    label: "Requested amount",
    help: "Enter an amount in US dollars, for example 10000. No commas or dollar sign needed.",
  },
  purpose: {
    title: "What will you use the financing for?",
    label: "Loan purpose",
    help: "A short description is enough, such as equipment or business expansion.",
  },
  industry: {
    title: "What industry is your business in?",
    label: "Industry",
    help: "Optional. Choose a broad description or skip if you’re unsure. These are demo industry options.",
  },
  review: {
    title: "Review your application setup",
    label: "Review",
    help: "Check your initial answers before finishing setup. You can correct any answer.",
  },
};
function fieldValue(data: ApplicationSetup, step: ApplicationSetupStep): string {
  return step === "business_name"
    ? (data.businessName ?? "")
    : step === "product"
      ? (data.productId ?? "")
      : step === "amount"
        ? (data.requestedAmount ?? "")
        : step === "purpose"
          ? (data.purpose ?? "")
          : step === "industry"
            ? (data.industryCode ?? "")
            : "";
}
export function SetupWizard(props: {
  session: AuthenticatedSession;
  applicationId: string;
  catalog: PublicIntake;
  refreshSession: () => Promise<void>;
}) {
  const query = useQuery({
    queryKey: ["setup", props.session.bank.id, props.session.user.email, props.applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${props.session.bank.id}/applications/${props.applicationId}/setup`,
        applicationSetupSchema,
        { signal },
      ),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  if (query.isPending || query.isFetching) return <p role="status">Loading your saved setup…</p>;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return query.data && <WizardForm {...props} initial={query.data} />;
}
function WizardForm({
  initial,
  session,
  applicationId,
  catalog,
  refreshSession,
}: {
  initial: ApplicationSetup;
  session: AuthenticatedSession;
  applicationId: string;
  catalog: PublicIntake;
  refreshSession: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const recoveryKey = answerKey(session.bank.id, session.user.email, applicationId);
  const [latestValue, setLatestValue] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const finishKey = useRef({ revision: 0, key: crypto.randomUUID() });
  const heading = useRef<HTMLHeadingElement>(null);
  // Keep product available for Back/review corrections, even when supplied by a bank hint.
  const [showProduct, setShowProduct] = useState(
    !initial.productId ||
      initial.currentStep === "product" ||
      initial.completedSteps.includes("product"),
  );
  const steps: ApplicationSetupStep[] = [
    "business_name",
    ...(showProduct ? ["product" as const] : []),
    "amount",
    "purpose",
    "industry",
    "review",
  ];
  const step = saved.currentStep;
  const position = Math.max(0, steps.indexOf(step));
  const question = questions[step];
  const form = useForm<{ value: string }>({
    defaultValues: {
      value:
        unsavedAnswer(recoveryKey, initial.currentStep) ?? fieldValue(initial, initial.currentStep),
    },
  });
  const value = form.watch("value");
  const dirty = value !== fieldValue(saved, step);
  const selectedProduct = saved.selectedProduct;
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}`;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    rememberAnswer(recoveryKey, step, dirty ? value : undefined);
  }, [recoveryKey, step, value, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function answers(requireAnswer: boolean): SaveApplicationSetup["answers"] {
    const entered = form.getValues("value").trim();
    if (step === "review") return {};
    if (!entered && !requireAnswer && !fieldValue(saved, step)) return {};
    if (!entered)
      throw new Error(
        step === "industry"
          ? "Choose an industry or use Skip for now."
          : "Please enter an answer before continuing.",
      );
    if (step === "business_name") return { businessName: entered };
    if (step === "purpose") return { purpose: entered };
    if (step === "product") return { productId: entered };
    if (step === "industry")
      return { industryCode: entered, industryTaxonomyVersion: "NAICS-demo-2022-v1" };
    const amount = decimalAmount(entered);
    if (
      selectedProduct &&
      (BigInt(amount.replace(".", "")) < BigInt(selectedProduct.minimumAmount.replace(".", "")) ||
        BigInt(amount.replace(".", "")) > BigInt(selectedProduct.maximumAmount.replace(".", "")))
    )
      throw new Error(
        `Enter an amount from ${formatAmount(selectedProduct.minimumAmount)} to ${formatAmount(selectedProduct.maximumAmount)} for this product.`,
      );
    return { requestedAmount: amount };
  }
  function accept(next: ApplicationSetup) {
    setRecoveryNotice(null);
    setSaved(next);
    if (next.currentStep === "product" || next.completedSteps.includes("product"))
      setShowProduct(true);
    form.reset({
      value: unsavedAnswer(recoveryKey, next.currentStep) ?? fieldValue(next, next.currentStep),
    });
    setLatestValue(null);
    queryClient.setQueryData(["setup", session.bank.id, session.user.email, applicationId], next);
  }
  async function save(
    target: ApplicationSetupStep,
    mode: "continue" | "back" | "later" | "skip" | "edit" | "change_product",
  ) {
    if (busy) return;
    form.clearErrors();
    setError(null);
    let body: SaveApplicationSetup;
    try {
      const raw = {
        expectedRevision: saved.revision,
        answers:
          mode === "change_product"
            ? {}
            : mode === "skip"
              ? { industryCode: null, industryTaxonomyVersion: null }
              : answers(mode === "continue"),
        currentStep: target,
        ...(mode === "continue" && step !== "review" ? { step } : {}),
        ...(mode === "skip" ? { step: "industry" as const, skip: true } : {}),
      };
      const parsed = saveApplicationSetupSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error(
          "Please check your answer. Business names may be up to 200 characters and purposes up to 500 characters.",
        );
      body = parsed.data;
    } catch (error) {
      form.setError("value", {
        message: error instanceof Error ? error.message : "Please check your answer.",
      });
      return;
    }
    setBusy(true);
    try {
      const next = await request(`${base}/setup`, applicationSetupSchema, {
        method: "PATCH",
        body,
        bankId: session.bank.id,
        actorEmail: session.user.email,
      });
      if (mode !== "change_product") rememberAnswer(recoveryKey, step);
      accept(next);
      if (mode === "change_product") {
        await queryClient.invalidateQueries({ queryKey: ["public-intake", session.bank.slug] });
        setRecoveryNotice(
          "Choose an available product. Any unsaved answer to your previous question is kept in this tab for when you return to it.",
        );
      }
      if (mode === "later") {
        await queryClient.invalidateQueries({ queryKey: ["applications"] });
        navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { state: { saved: true } });
      }
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function reloadLatest() {
    setBusy(true);
    try {
      const latest = await request(`${base}/setup`, applicationSetupSchema);
      if (latest.setupStatus === "completed") {
        navigate(applicationPath(applicationId, session.bank.slug), { replace: true });
        return;
      }
      if (latest.currentStep === step) {
        // Keep the typed answer while showing the competing server value before retrying.
        setLatestValue(fieldValue(latest, step) || "No answer saved");
        setSaved(latest);
      } else {
        // Honor server dependency resets (such as a product change requiring a new amount).
        // The previous unsaved answer remains available when its question is revisited.
        accept(latest);
        setRecoveryNotice(
          `Your saved setup moved to ${questions[latest.currentStep].label.toLowerCase()}. Any unsaved ${question.label.toLowerCase()} answer is kept in this tab for when you return to that question.`,
        );
      }
      setError(null);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    setError(null);
    if (finishKey.current.revision !== saved.revision)
      finishKey.current = { revision: saved.revision, key: crypto.randomUUID() };
    try {
      const next = await request(`${base}/setup/finish`, applicationSetupSchema, {
        method: "POST",
        bankId: session.bank.id,
        actorEmail: session.user.email,
        body: { expectedRevision: saved.revision, idempotencyKey: finishKey.current.key },
      });
      accept(next);
      await queryClient.invalidateQueries({ queryKey: ["destination"] });
      await queryClient.invalidateQueries({ queryKey: ["applications"] });
      navigate(applicationPath(applicationId, session.bank.slug), { replace: true });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  const failedField = form.formState.errors.value?.message;
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Initial application setup</span>
          <span aria-label="Setup progress">
            Step {position + 1} of {steps.length}
          </span>
        </div>
        <progress
          aria-label="Setup progress"
          className="h-1.5 w-full accent-primary"
          value={position + 1}
          max={steps.length}
        />
        <p className="text-xs text-muted-foreground">
          This is setup progress, not an approval decision.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-2xl leading-tight outline-none sm:text-3xl"
            >
              {question.title}
            </h1>
          </CardTitle>
          <CardDescription className="leading-6">{question.help}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedProduct && !selectedProduct.active && (
            <Alert>
              <AlertTitle>This financing product is no longer available</AlertTitle>
              <AlertDescription>
                Change your financing product to continue setup. Your other saved answers are safe.
              </AlertDescription>
            </Alert>
          )}
          <form
            noValidate
            onSubmit={form.handleSubmit(() =>
              step === "review"
                ? void finish()
                : void save(steps[position + 1] ?? "review", "continue"),
            )}
            className="space-y-6"
          >
            {step === "review" ? (
              <dl className="divide-y rounded-lg border px-4">
                {(["business_name", "product", "amount", "purpose", "industry"] as const).map(
                  (key) => (
                    <div key={key} className="flex items-start justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{questions[key].label}</dt>
                        <dd className="mt-1 break-words text-sm font-medium">
                          {key === "product"
                            ? (selectedProduct?.name ?? "Select a product")
                            : key === "amount" && saved.requestedAmount
                              ? formatAmount(saved.requestedAmount)
                              : key === "industry"
                                ? (industries.find(([code]) => code === saved.industryCode)?.[1] ??
                                  (saved.industryCode
                                    ? `Industry ${saved.industryCode}`
                                    : "Skipped — can be added later"))
                                : fieldValue(saved, key) || "Not answered"}
                        </dd>
                      </div>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        disabled={busy}
                        aria-label={`Edit ${questions[key].label.toLowerCase()}`}
                        onClick={() => {
                          void save(key, key === "product" ? "change_product" : "edit");
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  ),
                )}
              </dl>
            ) : (
              <div className="space-y-3">
                <label htmlFor="setup-answer" className="text-sm font-medium">
                  {question.label}
                </label>
                {step === "product" || step === "industry" ? (
                  <NativeSelect
                    id="setup-answer"
                    className="h-10 w-full"
                    {...form.register("value")}
                    aria-invalid={Boolean(failedField)}
                    aria-describedby="answer-help answer-error"
                    disabled={busy}
                  >
                    <NativeSelectOption value="">
                      {step === "product" ? "Choose a product" : "Choose an industry"}
                    </NativeSelectOption>
                    {step === "product" ? (
                      <>
                        {selectedProduct &&
                          !catalog.products.some(
                            (product) => product.id === selectedProduct.id,
                          ) && (
                            <NativeSelectOption
                              value={selectedProduct.id}
                              disabled={!selectedProduct.active}
                            >
                              {selectedProduct.name} (saved version {selectedProduct.version}
                              {selectedProduct.active ? "" : ", unavailable"})
                            </NativeSelectOption>
                          )}
                        {catalog.products.map((product) => (
                          <NativeSelectOption key={product.id} value={product.id}>
                            {product.name}
                          </NativeSelectOption>
                        ))}
                      </>
                    ) : (
                      <>
                        {saved.industryCode &&
                          !industries.some(([code]) => code === saved.industryCode) && (
                            <NativeSelectOption value={saved.industryCode}>
                              Industry {saved.industryCode}
                            </NativeSelectOption>
                          )}
                        {industries.map(([code, label]) => (
                          <NativeSelectOption key={code} value={code}>
                            {label}
                          </NativeSelectOption>
                        ))}
                      </>
                    )}
                  </NativeSelect>
                ) : (
                  <Input
                    id="setup-answer"
                    {...form.register("value")}
                    className="h-11"
                    inputMode={step === "amount" ? "decimal" : "text"}
                    autoComplete={step === "business_name" ? "organization" : "off"}
                    maxLength={step === "business_name" ? 200 : step === "purpose" ? 500 : 21}
                    aria-invalid={Boolean(failedField)}
                    aria-describedby="answer-help answer-error"
                    disabled={busy}
                  />
                )}
                <p id="answer-help" className="text-xs leading-5 text-muted-foreground">
                  {step === "amount" && selectedProduct
                    ? `${selectedProduct.name}: ${formatAmount(selectedProduct.minimumAmount)}–${formatAmount(selectedProduct.maximumAmount)}. Limits come from this bank’s product settings.`
                    : step === "industry"
                      ? "You don’t need to know a code. You can provide more detail later."
                      : "Save this answer with Continue, Back, or Continue later."}
                </p>
                {failedField && (
                  <p id="answer-error" role="alert" className="text-sm text-destructive">
                    {failedField}
                  </p>
                )}
              </div>
            )}
            {recoveryNotice && (
              <Alert role="status">
                <AlertTitle>Setup updated</AlertTitle>
                <AlertDescription>{recoveryNotice}</AlertDescription>
              </Alert>
            )}
            {latestValue !== null && (
              <Alert role="status">
                <AlertTitle>Latest saved answer: {latestValue}</AlertTitle>
                <AlertDescription>
                  Your entered answer is still in the field. Continue to save it using the latest
                  version.
                </AlertDescription>
              </Alert>
            )}
            {Boolean(error) && (
              <>
                <ErrorNotice error={error} />
                {error instanceof ApiError && error.code === "REVISION_CONFLICT" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void reloadLatest()}
                  >
                    Review latest saved version
                  </Button>
                )}
                {error instanceof ApiError && error.status === 401 && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await refreshSession();
                      } catch (error) {
                        setError(error);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Sign in again
                  </Button>
                )}
              </>
            )}
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {busy
                ? "Saving…"
                : error || failedField || dirty
                  ? "Unsaved changes. Your entered answer is still here."
                  : "Saved to your application."}
            </p>
            {step === "review" && (
              <p className="text-sm leading-6 text-muted-foreground">
                Finishing setup confirms these initial answers. It does not submit your application,
                approve financing, or complete later tasks.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : step === "review" ? "Finish setup" : "Continue"}
              </Button>
              {step === "industry" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void save("review", "skip")}
                >
                  Skip for now
                </Button>
              )}
              {position > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save(steps[position - 1] ?? "business_name", "back")}
                >
                  Back
                </Button>
              )}
            </div>
            <div className="space-y-2 border-t pt-4">
              {step !== "product" && step !== "review" && (
                <Button
                  type="button"
                  variant="link"
                  className="block px-0"
                  disabled={busy}
                  onClick={() => void save("product", "change_product")}
                >
                  Change financing product
                </Button>
              )}
              <Button
                type="button"
                variant="link"
                className="px-0"
                disabled={busy}
                onClick={() => void save(step, "later")}
              >
                Continue later
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                We’ll save your current answer and return you to this question next time. If saving
                fails, you’ll stay here.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Application reference {applicationId.slice(0, 8)} · Synthetic information only
      </p>
      {saved.nextDestination === "closed" && (
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Your applications
        </Link>
      )}
    </section>
  );
}
