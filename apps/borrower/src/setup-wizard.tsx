import {
  type ApplicationSetup,
  type ApplicationSetupStep,
  applicationSetupSchema,
  fundingPurposeCatalogVersion,
  fundingPurposeOptions,
  industryByCode,
  industryTaxonomyVersion,
  type SaveApplicationSetup,
  saveApplicationSetupSchema,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import { CurrencyInput, wholeDollars } from "@keycade/ui/components/currency-input";
import { useDemoApplication } from "@keycade/ui/components/demo-kit";
import { LoadingState } from "@keycade/ui/components/empty-state";
import { FundingPurposeIcon } from "@keycade/ui/components/funding-purpose-icon";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { Input } from "@keycade/ui/components/input";
import { SearchCombobox } from "@keycade/ui/components/search-combobox";
import { cn } from "@keycade/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Info,
  LockKeyhole,
  Minus,
  PencilLine,
  Save,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, decimalAmount, formatAmount, request } from "./api";
import { answerKey, rememberAnswer, unsavedAnswer } from "./unsaved-answers";
import { applicationPath, ErrorNotice, setupStepFromSlug, setupStepPath } from "./workspace-ui";

async function searchIndustries(query: string) {
  const catalog = await import("@keycade/contracts/industry-search");
  return catalog.searchIndustries(query);
}
const questions = {
  business_name: { title: "What is your legal business name?", label: "Legal business name" },
  business_address: { title: "What is your business address?", label: "Business address" },
  business_ein: { title: "What is your business EIN?", label: "Business EIN" },
  industry: { title: "What industry is your business in?", label: "Industry" },
  website: { title: "What is your business website?", label: "Website" },
  amount: { title: "How much would you like to borrow?", label: "Requested amount" },
  purpose: { title: "What are you seeking the funds for?", label: "Funding purposes" },
  other_purpose: {
    title: "Would you like to describe your other funding purpose?",
    label: "Other funding purpose",
  },
  review: { title: "Review your application setup", label: "Review" },
};
const blankAddress = {
  line1: "",
  line2: "",
  locality: "",
  region: "",
  postalCode: "",
  countryCode: "",
};
const addressFields = [
  ["line1", "Street address", "address-line1"],
  ["line2", "Address line 2 (optional)", "address-line2"],
  ["locality", "City", "address-level2"],
  ["region", "State or region", "address-level1"],
  ["postalCode", "Postal code", "postal-code"],
  ["countryCode", "Country code", "country"],
] as const;
const optionalSteps: ApplicationSetupStep[] = [
  "business_ein",
  "industry",
  "website",
  "other_purpose",
];
const sections: { title: string; steps: ApplicationSetupStep[] }[] = [
  {
    title: "Your business",
    steps: ["business_name", "business_address", "business_ein", "industry", "website"],
  },
  { title: "Your financing", steps: ["amount", "purpose", "other_purpose"] },
  { title: "Confirm", steps: ["review"] },
];
const sectionOf = (step: ApplicationSetupStep) =>
  sections.find((section) => section.steps.includes(step))?.title ?? "Your financing";
const helpText: Partial<Record<ApplicationSetupStep, string>> = {
  business_name: "Use the name registered for your business, as it appears on official documents.",
  business_address: "Where your business operates. We use this to confirm the lending area.",
  industry: "Search in plain language, like “dental office” or “bakery”.",
  website: "Optional. Enter a website like example.com. You can leave off https://.",
  amount:
    "Enter the amount you’d like to request in whole dollars. You can discuss changes with your lender.",
  other_purpose: "Optional. A short description helps your lender understand your plans.",
  review: "Check your answers before finishing setup. You can edit any of them.",
};
function fieldValue(data: ApplicationSetup, step: ApplicationSetupStep): string {
  if (step === "business_name") return data.businessName ?? "";
  if (step === "business_address") return JSON.stringify(data.businessAddress ?? blankAddress);
  if (step === "amount") return data.requestedAmount ? wholeDollars(data.requestedAmount) : "";
  if (step === "purpose") return JSON.stringify(data.fundingPurposes);
  if (step === "industry") return data.industryCode ?? "";
  if (step === "website") return data.website ?? "";
  if (step === "other_purpose") return data.otherPurposeDetail ?? "";
  return "";
}
function reviewValue(data: ApplicationSetup, step: ApplicationSetupStep): string {
  if (step === "business_ein")
    return data.businessEin.present
      ? `Saved — ${data.businessEin.mask}`
      : "Skipped — can be added later";
  if (step === "business_address")
    return data.businessAddress
      ? [
          data.businessAddress.line1,
          data.businessAddress.line2,
          data.businessAddress.locality,
          data.businessAddress.region,
          data.businessAddress.postalCode,
          data.businessAddress.countryCode,
        ]
          .filter(Boolean)
          .join(", ")
      : "Not answered";
  if (step === "amount")
    return data.requestedAmount ? formatAmount(data.requestedAmount) : "Not answered";
  if (step === "purpose")
    return (
      data.fundingPurposes
        .map((id) => fundingPurposeOptions.find((option) => option.id === id)?.label ?? id)
        .join(", ") || "Not answered"
    );
  if (step === "industry")
    return data.industryCode
      ? `${industryByCode(data.industryCode)?.title ?? "Industry"} (${data.industryCode})`
      : "Skipped — can be added later";
  return (
    fieldValue(data, step) ||
    (optionalSteps.includes(step) ? "Skipped — can be added later" : "Not answered")
  );
}
export function SetupWizard(props: {
  session: AuthenticatedSession;
  applicationId: string;
  refreshSession: () => Promise<void>;
}) {
  const query = useQuery({
    queryKey: ["setup", props.session.bank.id, props.session.user.email, props.applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${props.session.bank.id}/applications/${props.applicationId}/setup`,
        applicationSetupSchema,
        { signal, bankId: props.session.bank.id, actorEmail: props.session.user.email },
      ),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  if (query.isPending || query.isFetching)
    return <LoadingState>Loading your saved setup…</LoadingState>;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return query.data && <WizardForm {...props} initial={query.data} />;
}
function WizardForm({
  initial,
  session,
  applicationId,
  refreshSession,
}: {
  initial: ApplicationSetup;
  session: AuthenticatedSession;
  applicationId: string;
  refreshSession: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(initial);
  useDemoApplication(applicationId, saved.businessName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [replacing, setReplacing] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [latestValue, setLatestValue] = useState<string | null>(null);
  const recoveryKey = answerKey(session.bank.id, session.user.email, applicationId);
  const navigate = useNavigate();
  const urlStep = setupStepFromSlug(useParams().step);
  const queryClient = useQueryClient();
  const finishKey = useRef({ revision: 0, key: crypto.randomUUID() });
  const heading = useRef<HTMLHeadingElement>(null);
  const step = saved.currentStep === "product" ? "amount" : saved.currentStep;
  const question = questions[step];
  const form = useForm<{ value: string }>({
    defaultValues: {
      value:
        initial.currentStep === "business_ein"
          ? ""
          : (unsavedAnswer(recoveryKey, initial.currentStep) ??
            fieldValue(initial, initial.currentStep)),
    },
  });
  const value = form.watch("value");
  const purposes: ApplicationSetup["fundingPurposes"] =
    step === "purpose" ? JSON.parse(value || "[]") : saved.fundingPurposes;
  const steps: ApplicationSetupStep[] = [
    "business_name",
    "business_address",
    "business_ein",
    "industry",
    "website",
    "amount",
    "purpose",
    ...(purposes.includes("other") ? ["other_purpose" as const] : []),
    "review",
  ];
  const position = Math.max(0, steps.indexOf(step));
  const dirty = value !== fieldValue(saved, step);
  const selectedProduct = saved.selectedProduct;
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}`;
  const hasOptionalValue =
    optionalSteps.includes(step) &&
    (step === "business_ein" ? saved.businessEin.present : Boolean(fieldValue(saved, step)));
  const inputDisabled = busy || (hasOptionalValue && !replacing);
  const stepUrl = (key: ApplicationSetupStep) =>
    setupStepPath(applicationId, session.bank.slug, key === "product" ? "amount" : key);
  // A step can be opened by URL once it has been reached: any earlier step, any answered or
  // skipped step, and the first step after an unbroken run of settled questions.
  const settled = (key: ApplicationSetupStep) =>
    saved.completedSteps.includes(key) || saved.skippedSteps.includes(key);
  const reachable = (key: ApplicationSetupStep) =>
    steps.includes(key) &&
    (steps.indexOf(key) <= position ||
      settled(key) ||
      steps.slice(0, steps.indexOf(key)).every(settled));
  const routed = useRef(false);
  useEffect(() => {
    // Each saved step has its own address. A step change made here becomes a history entry.
    if (urlStep === step) {
      routed.current = true;
      return;
    }
    if (!routed.current && urlStep) return;
    navigate(stepUrl(step), { replace: !routed.current });
    routed.current = true;
  }, [step]);
  useEffect(() => {
    // Browser back/forward, reloads and typed addresses move the saved step when allowed.
    if (!urlStep || urlStep === step || busy) return;
    routed.current = true;
    if (reachable(urlStep)) {
      void save(urlStep, "edit").then((moved) => {
        if (!moved) navigate(stepUrl(step), { replace: true });
      });
    } else navigate(stepUrl(step), { replace: true });
  }, [urlStep]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    // EIN deliberately never enters the recovery cache or any browser persistence.
    if (step !== "business_ein") rememberAnswer(recoveryKey, step, dirty ? value : undefined);
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
    if (step === "review" || step === "business_ein") return {};
    if (step === "business_address") {
      const address = JSON.parse(entered);
      if (!address.line2?.trim()) delete address.line2;
      if (!requireAnswer && !Object.values(address).some(Boolean)) return {};
      return { businessAddress: address };
    }
    if (step === "purpose") {
      if (!purposes.length && requireAnswer)
        throw new Error("Choose at least one funding purpose.");
      return { fundingPurposes: purposes, purposeCatalogVersion: fundingPurposeCatalogVersion };
    }
    if (!entered && !requireAnswer && !fieldValue(saved, step)) return {};
    if (!entered)
      throw new Error(
        optionalSteps.includes(step)
          ? "Enter an answer or use Skip for now."
          : "Please enter an answer before continuing.",
      );
    if (step === "business_name") return { businessName: entered };
    if (step === "website") return { website: entered };
    if (step === "other_purpose") return { otherPurposeDetail: entered };
    if (step === "industry") {
      if (!industryByCode(entered))
        throw new Error("Choose an industry from the search results, or use Skip for now.");
      return { industryCode: entered, industryTaxonomyVersion };
    }
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
    form.reset({
      value:
        next.currentStep === "business_ein"
          ? ""
          : (unsavedAnswer(recoveryKey, next.currentStep) ?? fieldValue(next, next.currentStep)),
    });
    setReplacing(false);
    setLatestValue(null);
    queryClient.setQueryData(["setup", session.bank.id, session.user.email, applicationId], next);
  }
  function showError(error: unknown) {
    if (step === "business_ein" && error instanceof ApiError && error.status === 401) {
      // Session recovery retains ordinary answers only, never an unsubmitted identifier.
      form.reset({ value: "" });
      setReplacing(false);
    }
    setError(error);
  }
  async function save(
    target: ApplicationSetupStep,
    mode: "continue" | "back" | "later" | "skip" | "edit" | "clear",
  ) {
    if (busy) return false;
    form.clearErrors();
    setError(null);
    let body: SaveApplicationSetup;
    const enteredEin = step === "business_ein" && form.getValues("value").trim();
    const saveEin =
      step === "business_ein" &&
      (mode === "clear" || (enteredEin && !["skip", "edit"].includes(mode)));
    try {
      if (
        step === "business_ein" &&
        mode === "continue" &&
        !enteredEin &&
        !saved.businessEin.present
      )
        throw new Error("Enter a supported synthetic EIN or use Skip for now.");
      const cleared =
        step === "industry"
          ? { industryCode: null, industryTaxonomyVersion: null }
          : step === "website"
            ? { website: null }
            : step === "other_purpose"
              ? { otherPurposeDetail: null }
              : {};
      const parsed = saveApplicationSetupSchema.safeParse({
        definitionVersion: 2,
        expectedRevision: saved.revision,
        answers:
          mode === "skip" || mode === "edit" || saveEin
            ? {}
            : mode === "clear"
              ? cleared
              : answers(mode === "continue"),
        currentStep: target,
        ...(mode === "continue" && step !== "review" ? { step } : {}),
        ...(["skip", "clear"].includes(mode) ? { step, skip: true } : {}),
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const addressLabel = addressFields.find(([key]) => key === issue?.path.at(-1))?.[1];
        throw new Error(
          step === "business_address" && addressLabel
            ? `Please check ${addressLabel.toLowerCase()}.`
            : (issue?.message ?? "Please check your answer."),
        );
      }
      body = parsed.data;
    } catch (error) {
      form.setError("value", {
        message: error instanceof Error ? error.message : "Please check your answer.",
      });
      return false;
    }
    setBusy(true);
    try {
      const next = await request(
        saveEin ? `${base}/setup/identifier` : `${base}/setup`,
        applicationSetupSchema,
        {
          method: "PATCH",
          body: saveEin
            ? {
                definitionVersion: 2,
                expectedRevision: saved.revision,
                action: mode === "clear" ? "clear" : "save",
                ...(mode === "clear" ? {} : { value: enteredEin }),
                currentStep: target,
              }
            : body,
          bankId: session.bank.id,
          actorEmail: session.user.email,
          recoverSetupSession: true,
        },
      );
      if (mode !== "edit") rememberAnswer(recoveryKey, step);
      accept(next);
      if (mode === "later") {
        await queryClient.invalidateQueries({ queryKey: ["applications"] });
        navigate(`/?bank=${encodeURIComponent(session.bank.slug)}`, { state: { saved: true } });
      }
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function reloadLatest() {
    setBusy(true);
    try {
      const latest = await request(`${base}/setup`, applicationSetupSchema, {
        bankId: session.bank.id,
        actorEmail: session.user.email,
        recoverSetupSession: true,
      });
      if (latest.setupStatus === "completed") {
        navigate(applicationPath(applicationId, session.bank.slug), { replace: true });
        return;
      }
      if (latest.currentStep === step) {
        setLatestValue(reviewValue(latest, step));
        setSaved(latest);
        if (step === "business_ein") {
          form.reset({ value: "" });
          setReplacing(false);
        }
      } else {
        accept(latest);
        setRecoveryNotice(
          `Your saved setup moved to ${questions[latest.currentStep === "product" ? "amount" : latest.currentStep].label.toLowerCase()}. ${step === "business_ein" ? "Re-enter an unsaved EIN when you return to that question." : `Any unsaved ${question.label.toLowerCase()} answer is kept in this tab for when you return to that question.`}`,
        );
      }
      setError(null);
    } catch (error) {
      showError(error);
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
        recoverSetupSession: true,
        body: {
          definitionVersion: 2,
          expectedRevision: saved.revision,
          idempotencyKey: finishKey.current.key,
        },
      });
      accept(next);
      await queryClient.invalidateQueries({ queryKey: ["destination"] });
      await queryClient.invalidateQueries({ queryKey: ["applications"] });
      navigate(applicationPath(applicationId, session.bank.slug), { replace: true });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  const failedField = form.formState.errors.value?.message;
  const answerDescription =
    [
      step === "amount" || step === "business_ein" ? "answer-help" : null,
      failedField ? "answer-error" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const stepState = (key: ApplicationSetupStep) =>
    key === step
      ? "current"
      : saved.completedSteps.includes(key)
        ? "complete"
        : saved.skippedSteps.includes(key)
          ? "skipped"
          : "upcoming";
  return (
    <section className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
      <div className="hidden lg:sticky lg:top-8 lg:block">
        <p className="text-sm font-semibold">Initial application setup</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {steps.length - 1} short questions · Saved as you go
        </p>
        <div className="mt-6 space-y-6">
          {sections.map((section) => {
            const sectionSteps = steps.filter((key) => section.steps.includes(key));
            if (!sectionSteps.length) return null;
            return (
              <div key={section.title}>
                <p className="eyebrow">{section.title}</p>
                <ol className="mt-2.5 space-y-0.5">
                  {sectionSteps.map((key) => {
                    const state = stepState(key);
                    return (
                      <li
                        key={key}
                        aria-current={state === "current" ? "step" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                          state === "current" && "bg-card font-medium shadow-xs ring-1 ring-border",
                          state === "upcoming" && "text-muted-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border",
                            state === "complete" && "border-success bg-success text-white",
                            state === "current" && "border-info bg-info-soft",
                            state === "skipped" && "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {state === "complete" ? (
                            <Check className="size-3" strokeWidth={3} />
                          ) : state === "current" ? (
                            <span className="size-1.5 rounded-full bg-info" />
                          ) : state === "skipped" ? (
                            <Minus className="size-3" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {key === "review"
                            ? "Review and finish"
                            : questions[key === "product" ? "amount" : key].label}
                        </span>
                        {state === "skipped" && (
                          <span className="text-xs text-muted-foreground">Skipped</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
        <p className="mt-8 flex gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Use synthetic information only. Your answers are saved to this application.
        </p>
      </div>
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <span className="font-medium lg:text-muted-foreground">
            <span className="lg:hidden">Initial application setup</span>
            <span className="hidden lg:inline">{sectionOf(step)}</span>
          </span>
          <span className="text-muted-foreground tabular-nums">
            Step {position + 1} of {steps.length}
          </span>
        </div>
        <progress
          aria-label="Setup progress"
          className="mb-6 block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-border [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-info [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-info [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-500"
          value={position + 1}
          max={steps.length}
        />
        <div className="rounded-2xl border bg-card shadow-md">
          <div className="px-5 pt-5 sm:px-10 sm:pt-8">
            {position > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                disabled={busy}
                onClick={() => void save(steps[position - 1] ?? "business_name", "back")}
              >
                <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                Back
              </Button>
            ) : (
              <p className="eyebrow text-info">{sectionOf(step)}</p>
            )}
            <h1
              ref={heading}
              tabIndex={-1}
              className="mt-4 text-[1.625rem] leading-tight font-semibold tracking-tight text-balance outline-none sm:text-[2rem]"
            >
              {question.title}
            </h1>
            {helpText[step] && (
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                {helpText[step]}
              </p>
            )}
          </div>
          <div className="px-5 pt-6 pb-6 sm:px-10 sm:pb-8">
            {selectedProduct && !selectedProduct.active && (
              <Alert variant="warning" className="mb-6">
                <AlertTitle>This financial product is no longer available</AlertTitle>
                <AlertDescription>
                  Synthetic Business Credit is currently unavailable. Please contact the bank. Your
                  saved answers are safe.
                </AlertDescription>
              </Alert>
            )}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (step === "review") void finish();
                else void save(steps[position + 1] ?? "review", "continue");
              }}
              className="space-y-6"
            >
              {step === "review" ? (
                <dl className="divide-y overflow-hidden rounded-xl border">
                  {steps
                    .filter((key) => key !== "review")
                    .map((key) => {
                      const confirmed =
                        saved.completedSteps.includes(key) || saved.skippedSteps.includes(key);
                      return (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5"
                        >
                          <div className="min-w-0">
                            <dt className="text-xs font-medium text-muted-foreground">
                              {questions[key === "product" ? "amount" : key].label}
                            </dt>
                            <dd
                              className={cn(
                                "mt-1 break-words text-sm font-medium",
                                !confirmed && "text-warning",
                              )}
                            >
                              {confirmed
                                ? reviewValue(saved, key)
                                : "Not confirmed — review this answer"}
                            </dd>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="-mr-2 shrink-0 text-info"
                            disabled={busy}
                            aria-label={`Edit ${questions[key === "product" ? "amount" : key].label.toLowerCase()}`}
                            onClick={() => void save(key, "edit")}
                          >
                            <PencilLine aria-hidden="true" data-icon="inline-start" />
                            Edit
                          </Button>
                        </div>
                      );
                    })}
                  {saved.purpose && (
                    <div className="bg-muted/40 px-4 py-3.5 sm:px-5">
                      <dt className="text-xs font-medium text-muted-foreground">
                        Previous funding-purpose response
                      </dt>
                      <dd className="mt-1 break-words text-sm">{saved.purpose}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="space-y-3">
                  {step === "business_address" ? (
                    <fieldset
                      className="grid gap-4 sm:grid-cols-2"
                      disabled={busy}
                      aria-describedby={failedField ? "answer-error" : undefined}
                    >
                      <legend className="sr-only">Business address</legend>
                      {addressFields.map(([key, label, autoComplete]) => (
                        <div
                          key={key}
                          className={cn(
                            "space-y-2",
                            (key === "line1" || key === "line2") && "sm:col-span-2",
                          )}
                        >
                          <label htmlFor={`setup-${key}`} className="text-sm font-medium">
                            {label}
                          </label>
                          <Input
                            id={`setup-${key}`}
                            className="h-11"
                            value={JSON.parse(value)[key] ?? ""}
                            onChange={(event) =>
                              form.setValue(
                                "value",
                                JSON.stringify({
                                  ...JSON.parse(value),
                                  [key]:
                                    key === "countryCode"
                                      ? event.target.value.toUpperCase()
                                      : event.target.value,
                                }),
                                { shouldDirty: true },
                              )
                            }
                            autoComplete={autoComplete}
                            maxLength={key === "countryCode" ? 2 : key === "postalCode" ? 20 : 200}
                            aria-invalid={Boolean(failedField)}
                          />
                        </div>
                      ))}
                      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                        Enter the two-letter country code, such as US or CA.
                      </p>
                    </fieldset>
                  ) : step === "purpose" ? (
                    <fieldset
                      disabled={busy}
                      aria-describedby={failedField ? "answer-error" : "purpose-help"}
                    >
                      <legend className="sr-only">Funding purposes</legend>
                      <p id="purpose-help" className="mb-4 text-sm text-muted-foreground">
                        Choose one or more purposes.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {fundingPurposeOptions.map((option) => (
                          <label
                            key={option.id}
                            className="group/purpose flex cursor-pointer items-center gap-3.5 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/25 has-checked:border-info has-checked:bg-info-soft/60 has-checked:ring-1 has-checked:ring-info has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-has-checked/purpose:bg-info [&_svg]:size-5 [&_svg]:text-muted-foreground group-has-checked/purpose:[&_svg]:text-info-foreground">
                              <FundingPurposeIcon id={option.id} />
                            </span>
                            <span className="min-w-0 flex-1 text-sm font-medium">
                              {option.label}
                            </span>
                            <input
                              type="checkbox"
                              className="size-5 shrink-0 accent-info"
                              checked={purposes.includes(option.id)}
                              onChange={(event) =>
                                form.setValue(
                                  "value",
                                  JSON.stringify(
                                    event.target.checked
                                      ? [...purposes, option.id]
                                      : purposes.filter((id) => id !== option.id),
                                  ),
                                  { shouldDirty: true },
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <>
                      <label htmlFor="setup-answer" className="text-sm font-medium">
                        {question.label}
                      </label>
                      {step === "industry" ? (
                        <SearchCombobox
                          id="setup-answer"
                          value={industryByCode(value) ?? null}
                          onSelect={(industry) =>
                            form.setValue("value", industry.code, { shouldDirty: true })
                          }
                          search={searchIndustries}
                          invalid={Boolean(failedField)}
                          describedBy={answerDescription}
                          disabled={inputDisabled}
                        />
                      ) : step === "amount" ? (
                        <CurrencyInput
                          id="setup-answer"
                          aria-label={question.label}
                          className="h-12 pl-8 text-base font-medium md:text-base"
                          prefixClassName="left-3.5 text-base font-medium"
                          value={value}
                          onValueChange={(digits) =>
                            form.setValue("value", digits, { shouldDirty: true })
                          }
                          aria-invalid={Boolean(failedField)}
                          aria-describedby={answerDescription}
                          disabled={inputDisabled}
                        />
                      ) : (
                        <Input
                          id="setup-answer"
                          aria-label={question.label}
                          {...form.register("value")}
                          className="h-12 text-base md:text-base"
                          type={
                            step === "business_ein"
                              ? "password"
                              : step === "website"
                                ? "url"
                                : "text"
                          }
                          inputMode={step === "business_ein" ? "numeric" : "text"}
                          autoComplete={step === "business_name" ? "organization" : "off"}
                          maxLength={
                            step === "business_name"
                              ? 200
                              : step === "website"
                                ? 2048
                                : step === "other_purpose"
                                  ? 500
                                  : 10
                          }
                          aria-invalid={Boolean(failedField)}
                          aria-describedby={answerDescription}
                          disabled={inputDisabled}
                        />
                      )}
                      {step === "business_ein" && (
                        <p
                          id="answer-help"
                          className="flex gap-2 rounded-lg bg-info-soft px-3 py-2.5 text-xs leading-5 text-foreground"
                        >
                          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-info" />
                          <span>
                            Synthetic information only. Use a supported demo EIN from 000000001 to
                            000000007. Never enter a real EIN or SSN. You can skip this question.
                          </span>
                        </p>
                      )}
                      {step === "amount" && selectedProduct && (
                        <p id="answer-help" className="text-xs leading-5 text-muted-foreground">
                          Synthetic Business Credit: {formatAmount(selectedProduct.minimumAmount)}–
                          {formatAmount(selectedProduct.maximumAmount)}
                        </p>
                      )}
                      {hasOptionalValue && (
                        <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                          <p className="flex items-start gap-2 break-words text-sm">
                            <CircleCheck
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0 text-success"
                            />
                            <span>Saved answer: {reviewValue(saved, step)}</span>
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy || replacing}
                              onClick={() => setReplacing(true)}
                            >
                              Replace saved{" "}
                              {step === "business_ein" ? "EIN" : question.label.toLowerCase()}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void save(step, "clear")}
                            >
                              Clear saved{" "}
                              {step === "business_ein" ? "EIN" : question.label.toLowerCase()}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {failedField && (
                    <p
                      id="answer-error"
                      role="alert"
                      className="text-sm font-medium text-destructive"
                    >
                      {failedField}
                    </p>
                  )}
                </div>
              )}
              {recoveryNotice && (
                <Alert role="status" variant="info">
                  <AlertTitle>Setup updated</AlertTitle>
                  <AlertDescription>{recoveryNotice}</AlertDescription>
                </Alert>
              )}
              {latestValue !== null && (
                <Alert role="status" variant="info">
                  <AlertTitle>Latest saved answer: {latestValue}</AlertTitle>
                  <AlertDescription>
                    {step === "business_ein"
                      ? "Only the saved mask is shown. Choose Replace saved EIN to enter a replacement."
                      : "Your entered answer is still in the field. Continue to save it using the latest version."}
                  </AlertDescription>
                </Alert>
              )}
              {Boolean(error) && (
                <>
                  <ErrorNotice error={error} />
                  {error instanceof ApiError &&
                    ["REVISION_CONFLICT", "SETUP_VERSION_UNSUPPORTED"].includes(error.code) && (
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
              <p role="status" aria-live="polite" className="sr-only">
                {busy ? "Saving…" : null}
              </p>
              {step === "review" && (
                <p className="flex gap-2.5 rounded-lg bg-muted/60 px-4 py-3 text-sm leading-6 text-muted-foreground">
                  <Info aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  Finishing setup confirms these initial answers. It does not submit your
                  application, approve financing, or complete later tasks.
                </p>
              )}
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
                <Button
                  loading={busy}
                  type="submit"
                  size="lg"
                  disabled={busy}
                  className="sm:min-w-40"
                >
                  {step === "review" ? "Finish setup" : "Continue"}
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </Button>
                {optionalSteps.includes(step) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={busy}
                    onClick={() => void save(steps[position + 1] ?? "review", "skip")}
                  >
                    Skip for now
                  </Button>
                )}
              </div>
            </form>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t bg-muted/40 px-5 py-3.5 sm:px-10">
            <p className="text-xs text-muted-foreground">
              Application reference {applicationId.slice(0, 8)} · Synthetic information only
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2"
              disabled={busy}
              onClick={() => void save(step, "later")}
            >
              <Save aria-hidden="true" data-icon="inline-start" />
              Continue later
            </Button>
          </div>
        </div>
        {saved.nextDestination === "closed" && (
          <Link to="/" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
            Your applications
          </Link>
        )}
      </div>
    </section>
  );
}
