import {
  applicationSetupSchema,
  businessAddressSchema,
  businessWebsiteSchema,
  type FundingPurposeId,
  fundingPurposeCatalogVersion,
  fundingPurposeOptions,
  type StaffWorkspace,
} from "@keycade/contracts";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { CurrencyInput, wholeDollars } from "@keycade/ui/components/currency-input";
import { FundingPurposeIcon } from "@keycade/ui/components/funding-purpose-icon";
import { Input } from "@keycade/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError, decimalAmount, useStaffApi } from "./api";
import { ErrorNotice, Field } from "./ui";

type Answers = {
  businessName: string;
  requestedAmount: string;
  website: string;
  line1: string;
  line2: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  fundingPurposes: FundingPurposeId[];
  otherPurposeDetail: string;
};
function initialAnswers(workspace?: StaffWorkspace): Answers {
  return {
    businessName: workspace?.businessName ?? "",
    requestedAmount: workspace?.requestedAmount ? wholeDollars(workspace.requestedAmount) : "",
    website: workspace?.website ?? "",
    line1: workspace?.businessAddress?.line1 ?? "",
    line2: workspace?.businessAddress?.line2 ?? "",
    locality: workspace?.businessAddress?.locality ?? "",
    region: workspace?.businessAddress?.region ?? "",
    postalCode: workspace?.businessAddress?.postalCode ?? "",
    countryCode: workspace?.businessAddress?.countryCode ?? "",
    fundingPurposes: workspace?.fundingPurposes ?? [],
    otherPurposeDetail: workspace?.otherPurposeDetail ?? "",
  };
}
function answersPayload(answers: Answers) {
  const hasAddress = [
    answers.line1,
    answers.line2,
    answers.locality,
    answers.region,
    answers.postalCode,
    answers.countryCode,
  ].some((value) => value.trim());
  const address = businessAddressSchema.safeParse({
    line1: answers.line1,
    ...(answers.line2.trim() ? { line2: answers.line2 } : {}),
    locality: answers.locality,
    region: answers.region,
    postalCode: answers.postalCode,
    countryCode: answers.countryCode,
  });
  if (hasAddress && !address.success)
    throw new ApiError(
      "INVALID_INPUT",
      400,
      "Enter a complete business address, including a two-letter country code.",
    );
  const website = businessWebsiteSchema.safeParse(answers.website);
  if (answers.website.trim() && !website.success)
    throw new ApiError("INVALID_INPUT", 400, "Enter a valid HTTP or HTTPS website.");
  return {
    ...(answers.businessName.trim() ? { businessName: answers.businessName.trim() } : {}),
    ...(answers.requestedAmount.trim()
      ? { requestedAmount: decimalAmount(answers.requestedAmount) }
      : {}),
    ...(hasAddress && address.success ? { businessAddress: address.data } : {}),
    ...(website.success ? { website: website.data } : {}),
    ...(answers.fundingPurposes.length
      ? {
          fundingPurposes: answers.fundingPurposes,
          purposeCatalogVersion: fundingPurposeCatalogVersion,
        }
      : {}),
    ...(answers.otherPurposeDetail.trim()
      ? { otherPurposeDetail: answers.otherPurposeDetail.trim() }
      : {}),
  };
}
function AnswerFields({
  answers,
  setAnswers,
  disabled,
}: {
  answers: Answers;
  setAnswers: (value: Answers) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="business-name" label="Legal business name">
          <Input
            id="business-name"
            value={answers.businessName}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setAnswers({ ...answers, businessName: event.target.value })}
          />
        </Field>
        <Field id="requested-amount" label="Requested amount (USD)">
          <CurrencyInput
            id="requested-amount"
            value={answers.requestedAmount}
            disabled={disabled}
            onValueChange={(requestedAmount) => setAnswers({ ...answers, requestedAmount })}
          />
        </Field>
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-medium">Business address (optional prefill)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["line1", "Street address"],
              ["line2", "Address line 2 (optional)"],
              ["locality", "City"],
              ["region", "State / region"],
              ["postalCode", "Postal code"],
              ["countryCode", "Country code (US, CA, etc.)"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} id={`prefill-${key}`} label={label}>
              <Input
                id={`prefill-${key}`}
                value={answers[key]}
                disabled={disabled}
                maxLength={key === "countryCode" ? 2 : 200}
                onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field id="website" label="Business website (optional)">
        <Input
          id="website"
          value={answers.website}
          disabled={disabled}
          maxLength={2048}
          placeholder="https://example.test"
          onChange={(event) => setAnswers({ ...answers, website: event.target.value })}
        />
      </Field>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Funding purposes (optional prefill)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {fundingPurposeOptions.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-checked:border-info has-checked:bg-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-info"
                disabled={disabled}
                checked={answers.fundingPurposes.includes(option.id)}
                onChange={(event) =>
                  setAnswers({
                    ...answers,
                    fundingPurposes: event.target.checked
                      ? [...answers.fundingPurposes, option.id]
                      : answers.fundingPurposes.filter((id) => id !== option.id),
                  })
                }
              />
              <FundingPurposeIcon id={option.id} />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {answers.fundingPurposes.includes("other") && (
        <Field id="other-purpose" label="Other purpose details (optional)">
          <Input
            id="other-purpose"
            value={answers.otherPurposeDetail}
            disabled={disabled}
            maxLength={500}
            onChange={(event) => setAnswers({ ...answers, otherPurposeDetail: event.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
export function CreateApplication() {
  const api = useStaffApi();
  const navigate = useNavigate();
  const bank = new URLSearchParams(useLocation().search).get("bank");
  const bankQuery = bank ? `?bank=${encodeURIComponent(bank)}` : "";
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers());
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const prefill = answersPayload(answers);
      const normalized = email.trim().toLowerCase();
      const body = {
        email: normalized,
        ...(Object.keys(prefill).length ? { answers: prefill } : {}),
      };
      const payload = JSON.stringify(body);
      if (!attempt.current || attempt.current.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      setPending(true);
      const created = await api.request("/applications", applicationSetupSchema, {
        method: "POST",
        body: { ...body, idempotencyKey: attempt.current.key },
      });
      await client.invalidateQueries({ queryKey: ["staff-queue"] });
      navigate(`/applications/${created.id}/overview${bankQuery}`, {
        replace: true,
        state: { created: true },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        attempt.current = null;
        setPending(false);
      }
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <Link to={`/${bankQuery}`} className="text-sm underline underline-offset-4">
        Back to applications
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create an application</CardTitle>
          <CardDescription>
            Start an application for your bank and invite the borrower to finish it. Only their
            email is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-6">
            <Field id="borrower-email" label="Borrower email">
              <Input
                id="borrower-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                disabled={busy || pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <div className="space-y-4">
              <h2 className="text-sm font-medium">Prefill answers (optional)</h2>
              <p className="text-sm text-muted-foreground">
                Add any details you already know for Synthetic Business Credit. The borrower will
                confirm these answers and finish the remaining setup questions.
              </p>
              <AnswerFields answers={answers} setAnswers={setAnswers} disabled={busy || pending} />
            </div>
            <p className="text-sm text-muted-foreground">
              A simulated continuation email will invite the borrower to this application.
            </p>
            {Boolean(error) && <ErrorNotice error={error} />}
            {Boolean(error) && pending && (
              <p className="text-sm text-muted-foreground">
                The result could not be confirmed. Retry with these same details to recover the
                application and invitation.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button loading={busy} type="submit" disabled={busy}>
                {pending ? "Retry creation and invitation" : "Create and invite borrower"}
              </Button>
              <Link to={`/${bankQuery}`} className={buttonVariants({ variant: "outline" })}>
                {pending ? "Back to applications" : "Cancel"}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
export function PrefillForm({
  workspace,
  onSaved,
  onReload,
  onCancel,
}: {
  workspace: StaffWorkspace;
  onSaved: () => Promise<void>;
  onReload: () => Promise<StaffWorkspace>;
  onCancel: () => void;
}) {
  const api = useStaffApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(workspace));
  const [baseRevision, setBaseRevision] = useState(workspace.revision);
  const [currentStep, setCurrentStep] = useState(workspace.setup.currentStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.request(
        `/applications/${workspace.id}/setup`,
        applicationSetupSchema,
        {
          method: "PATCH",
          body: {
            definitionVersion: 2,
            expectedRevision: baseRevision,
            currentStep,
            answers: answersPayload(answers),
          },
        },
      );
      setBaseRevision(updated.revision);
      setCurrentStep(updated.currentStep);
      await onSaved();
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto overscroll-contain rounded-2xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-foreground/40 backdrop:backdrop-blur-[2px] sm:w-[calc(100%-3rem)]"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
            Prefilled answers
          </h2>
          <Button
            ref={closeButton}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close prefilled answers"
          >
            Close
          </Button>
        </div>
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          The borrower must confirm these answers. Saving does not complete setup. Leave a field
          empty to keep its saved answer.
        </p>
        <AnswerFields answers={answers} setAnswers={setAnswers} disabled={busy} />
        {Boolean(error) && <ErrorNotice error={error} />}
        {error instanceof ApiError && error.status === 409 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              try {
                const latest = await onReload();
                setAnswers(initialAnswers(latest));
                setBaseRevision(latest.revision);
                setCurrentStep(latest.setup.currentStep);
                setError(null);
              } catch (nextError) {
                setError(nextError);
              }
            }}
          >
            Reload saved record and replace edits
          </Button>
        )}
        {saved && (
          <p role="status" className="text-sm">
            Prefilled answers saved. Setup still requires borrower confirmation.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button loading={busy} type="submit" disabled={busy}>
            Save prefilled answers
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Close editor
          </Button>
        </div>
      </form>
    </dialog>
  );
}
