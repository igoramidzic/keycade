import {
  type ApplicationSetup,
  applicationSetupSchema,
  type StaffWorkspace,
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
import { Input } from "@keycade/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError, decimalAmount, useStaffApi } from "./api";
import { ErrorNotice, Field } from "./ui";

type Answers = { businessName: string; requestedAmount: string; purpose: string };
function answersPayload(answers: Answers) {
  return {
    ...(answers.businessName.trim() ? { businessName: answers.businessName.trim() } : {}),
    ...(answers.requestedAmount.trim()
      ? { requestedAmount: decimalAmount(answers.requestedAmount) }
      : {}),
    ...(answers.purpose.trim() ? { purpose: answers.purpose.trim() } : {}),
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
    <div className="grid gap-5 sm:grid-cols-2">
      <Field id="business-name" label="Business name">
        <Input
          id="business-name"
          value={answers.businessName}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => setAnswers({ ...answers, businessName: event.target.value })}
        />
      </Field>
      <Field id="requested-amount" label="Requested amount (USD)">
        <Input
          id="requested-amount"
          inputMode="decimal"
          value={answers.requestedAmount}
          disabled={disabled}
          onChange={(event) => setAnswers({ ...answers, requestedAmount: event.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field id="purpose" label="Purpose">
          <Input
            id="purpose"
            value={answers.purpose}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => setAnswers({ ...answers, purpose: event.target.value })}
          />
        </Field>
      </div>
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
  const [answers, setAnswers] = useState<Answers>({
    businessName: "",
    requestedAmount: "",
    purpose: "",
  });
  const attempt = useRef<{ email: string; key: string; draft: ApplicationSetup | null } | null>(
    null,
  );
  const [created, setCreated] = useState<ApplicationSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const prefill = answersPayload(answers);
      const normalized = email.trim().toLowerCase();
      if (!attempt.current || attempt.current.email !== normalized)
        attempt.current = { email: normalized, key: crypto.randomUUID(), draft: null };
      const current = attempt.current;
      if (!current.draft)
        current.draft = await api.request("/applications", applicationSetupSchema, {
          method: "POST",
          body: { email: normalized, idempotencyKey: current.key },
        });
      setCreated(current.draft);
      if (Object.keys(prefill).length)
        current.draft = await api.request(
          `/applications/${current.draft.id}/setup`,
          applicationSetupSchema,
          {
            method: "PATCH",
            body: {
              expectedRevision: current.draft.revision,
              currentStep: current.draft.currentStep,
              answers: prefill,
            },
          },
        );
      await client.invalidateQueries({ queryKey: ["staff-queue"] });
      navigate(`/applications/${current.draft.id}/overview${bankQuery}`, {
        replace: true,
        state: { created: true },
      });
    } catch (error) {
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
            Create a draft for a borrower and send a continuation link to the local inbox.
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
                disabled={busy || Boolean(created)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <div className="space-y-4">
              <h2 className="text-sm font-medium">Prefill answers (optional)</h2>
              <p className="text-sm text-muted-foreground">
                The product is Synthetic Business Credit. The borrower must confirm these answers
                and finish initial setup.
              </p>
              <AnswerFields answers={answers} setAnswers={setAnswers} disabled={busy} />
            </div>
            {Boolean(error) && <ErrorNotice error={error} />}
            {created && (
              <Alert>
                <AlertTitle>The draft was created</AlertTitle>
                <AlertDescription>
                  <p>
                    Your prefilled answers have not been confirmed as saved. Retry with the same
                    draft or open it to inspect the saved record.
                  </p>
                  <Link
                    className="underline"
                    to={`/applications/${created.id}/overview${bankQuery}`}
                  >
                    Open created draft
                  </Link>
                </AlertDescription>
              </Alert>
            )}
            {created && error instanceof ApiError && error.status === 409 && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    const latest = await api.request(
                      `/applications/${created.id}/setup`,
                      applicationSetupSchema,
                    );
                    if (attempt.current) attempt.current.draft = latest;
                    setCreated(latest);
                    setAnswers({
                      businessName: latest.businessName ?? "",
                      requestedAmount: latest.requestedAmount ?? "",
                      purpose: latest.purpose ?? "",
                    });
                    setError(null);
                  } catch (nextError) {
                    setError(nextError);
                  }
                }}
              >
                Reload saved record and replace edits
              </Button>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : created ? "Retry prefill" : "Create draft"}
              </Button>
              <Link to={`/${bankQuery}`} className={buttonVariants({ variant: "outline" })}>
                Cancel
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
  const [answers, setAnswers] = useState<Answers>({
    businessName: workspace.businessName ?? "",
    requestedAmount: workspace.requestedAmount ?? "",
    purpose: workspace.purpose ?? "",
  });
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
    <form onSubmit={(event) => void submit(event)} className="space-y-5 rounded-xl border p-5">
      <h3 className="font-medium">Prefilled answers</h3>
      <p className="text-sm text-muted-foreground">
        The borrower must confirm these answers. Saving does not complete setup. Leave a field empty
        to keep its saved answer.
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
              setAnswers({
                businessName: latest.businessName ?? "",
                requestedAmount: latest.requestedAmount ?? "",
                purpose: latest.purpose ?? "",
              });
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
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save prefilled answers"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Close editor
        </Button>
      </div>
    </form>
  );
}
