import { applicationSetupSchema, type StaffWorkspace } from "@keycade/contracts";
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
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Creating and inviting…"
                  : pending
                    ? "Retry creation and invitation"
                    : "Create and invite borrower"}
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
