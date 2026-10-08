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
import { Card, CardContent, CardHeader, CardTitle } from "@keycade/ui/components/card";
import { useDemoApplication } from "@keycade/ui/components/demo-kit";
import { FundingPurposeIcon } from "@keycade/ui/components/funding-purpose-icon";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { Input } from "@keycade/ui/components/input";
import { SearchCombobox } from "@keycade/ui/components/search-combobox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { ApiError, decimalAmount, formatAmount, request } from "./api";
import { answerKey, rememberAnswer, unsavedAnswer } from "./unsaved-answers";
import { applicationPath, ErrorNotice } from "./workspace-ui";

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
function fieldValue(data: ApplicationSetup, step: ApplicationSetupStep): string {
  if (step === "business_name") return data.businessName ?? "";
  if (step === "business_address") return JSON.stringify(data.businessAddress ?? blankAddress);
  if (step === "amount") return data.requestedAmount ?? "";
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
  if (query.isPending || query.isFetching) return <p role="status">Loading your saved setup…</p>;
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
  useEffect(() => {
    heading.current?.focus();
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
    if (busy) return;
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
      return;
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
    } catch (error) {
      showError(error);
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
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedProduct && !selectedProduct.active && (
            <Alert>
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
              <dl className="divide-y rounded-lg border px-4">
                {steps
                  .filter((key) => key !== "review")
                  .map((key) => (
                    <div key={key} className="flex items-start justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">
                          {questions[key === "product" ? "amount" : key].label}
                        </dt>
                        <dd className="mt-1 break-words text-sm font-medium">
                          {saved.completedSteps.includes(key) || saved.skippedSteps.includes(key)
                            ? reviewValue(saved, key)
                            : "Not confirmed — review this answer"}
                        </dd>
                      </div>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        disabled={busy}
                        aria-label={`Edit ${questions[key === "product" ? "amount" : key].label.toLowerCase()}`}
                        onClick={() => void save(key, "edit")}
                      >
                        Edit
                      </Button>
                    </div>
                  ))}
                {saved.purpose && (
                  <div className="py-4">
                    <dt className="text-xs text-muted-foreground">
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
                    className="space-y-4"
                    disabled={busy}
                    aria-describedby={failedField ? "answer-error" : undefined}
                  >
                    <legend className="mb-3 text-sm font-medium">Business address</legend>
                    {addressFields.map(([key, label, autoComplete]) => (
                      <div key={key} className="space-y-2">
                        <label htmlFor={`setup-${key}`} className="text-sm font-medium">
                          {label}
                        </label>
                        <Input
                          id={`setup-${key}`}
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
                    <p className="text-xs text-muted-foreground">
                      Enter the two-letter country code, such as US or CA.
                    </p>
                  </fieldset>
                ) : step === "purpose" ? (
                  <fieldset
                    disabled={busy}
                    aria-describedby={failedField ? "answer-error" : "purpose-help"}
                  >
                    <legend className="mb-2 text-sm font-medium">Funding purposes</legend>
                    <p id="purpose-help" className="mb-4 text-sm text-muted-foreground">
                      Choose one or more purposes.
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {fundingPurposeOptions.map((option) => (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring ${purposes.includes(option.id) ? "border-primary bg-accent" : "border-input"}`}
                        >
                          <FundingPurposeIcon id={option.id} />
                          <span className="min-w-0 flex-1 text-sm font-medium">{option.label}</span>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
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
                    ) : (
                      <Input
                        id="setup-answer"
                        aria-label={question.label}
                        {...form.register("value")}
                        className="h-11"
                        type={
                          step === "business_ein" ? "password" : step === "website" ? "url" : "text"
                        }
                        inputMode={
                          step === "amount"
                            ? "decimal"
                            : step === "business_ein"
                              ? "numeric"
                              : "text"
                        }
                        autoComplete={step === "business_name" ? "organization" : "off"}
                        maxLength={
                          step === "business_name"
                            ? 200
                            : step === "website"
                              ? 2048
                              : step === "other_purpose"
                                ? 500
                                : step === "business_ein"
                                  ? 10
                                  : 21
                        }
                        aria-invalid={Boolean(failedField)}
                        aria-describedby={answerDescription}
                        disabled={inputDisabled}
                      />
                    )}
                    {step === "business_ein" && (
                      <p id="answer-help" className="text-xs leading-5 text-muted-foreground">
                        Synthetic information only. Use a supported demo EIN from 000000001 to
                        000000007. Never enter a real EIN or SSN. You can skip this question.
                      </p>
                    )}
                    {step === "website" && (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>
                          {saved.industryCode
                            ? `${industryByCode(saved.industryCode)?.title ?? "Industry"} · NAICS ${saved.industryCode}`
                            : "Industry not provided"}
                        </p>
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto px-0"
                          disabled={busy}
                          onClick={() => void save("industry", "edit")}
                        >
                          Edit industry
                        </Button>
                      </div>
                    )}
                    {step === "amount" && selectedProduct && (
                      <p id="answer-help" className="text-xs leading-5 text-muted-foreground">
                        Synthetic Business Credit: {formatAmount(selectedProduct.minimumAmount)}–
                        {formatAmount(selectedProduct.maximumAmount)}
                      </p>
                    )}
                    {hasOptionalValue && (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="break-words text-sm">
                          Saved answer: {reviewValue(saved, step)}
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
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground empty:hidden"
            >
              {busy ? "Saving…" : null}
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
              {optionalSteps.includes(step) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void save(steps[position + 1] ?? "review", "skip")}
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
              <Button
                type="button"
                variant="link"
                className="px-0"
                disabled={busy}
                onClick={() => void save(step, "later")}
              >
                Continue later
              </Button>
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
