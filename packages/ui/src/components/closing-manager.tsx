import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { type ReadinessData, ReadinessPanel } from "@keycade/ui/components/checks-manager";
import {
  exactUsd,
  FundedAccountCard,
  type FundedAccountData,
} from "@keycade/ui/components/funded-accounts";
import { Input } from "@keycade/ui/components/input";
import { workflowName, workflowText } from "@keycade/ui/lib/workflow-text";
import { useEffect, useRef, useState } from "react";

export type ClosingData = {
  applicationId: string;
  revision: number;
  status: string;
  canManage: boolean;
  capabilities: { startClosing: boolean; recordFunding: boolean };
  approvedTerms: {
    businessName: string;
    productName: string;
    requestedAmount: string;
    approvedAmount: string;
    approvedAt: string;
  } | null;
  package: { revision: number; amountPolicy: "exact_approved_amount"; createdAt: string } | null;
  conditions: {
    id: string;
    title: string;
    kind: "task" | "signature";
    required: boolean;
    taskId: string;
    passes: boolean;
    signatureEnvelopeId: string | null;
    signatureState: string | null;
  }[];
  readiness: ReadinessData;
  account: FundedAccountData | null;
};
export type FundingInput = {
  fundedAmount: string;
  fundedOn: string;
  reference: string;
  humanFundingConfirmed: true;
};
const signatureStates: Record<string, string> = {
  draft: "Draft signature request",
  sent: "Awaiting signatures",
  partially_signed: "Partially signed",
  completed: "Signatures completed",
  declined: "Signature declined",
  expired: "Signature expired",
  voided: "Signature voided",
};

export function ClosingManager({
  data,
  taskHref,
  signatureHref,
  reviewHref,
  mutate,
  reload,
  errorMessage,
}: {
  data: ClosingData;
  taskHref: (taskId: string) => string;
  signatureHref: (envelopeId: string | null) => string;
  reviewHref: string;
  mutate: (
    action: "start" | "fund",
    input: FundingInput | null,
    expectedRevision: number,
    idempotencyKey: string,
  ) => Promise<ClosingData>;
  reload: () => Promise<ClosingData>;
  errorMessage: (error: unknown) => string;
}) {
  const [snapshot, setSnapshot] = useState(data);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const stale = conflict || (!busy && data.revision > snapshot.revision);
  // Readiness can change without changing the immutable approved terms or draft form.
  const current = data.revision === snapshot.revision ? data : snapshot;
  useEffect(() => {
    if (!editing && !busy && !conflict && data.revision >= snapshot.revision) setSnapshot(data);
  }, [data, snapshot.revision, editing, busy, conflict]);
  async function perform(action: "start" | "fund", input: FundingInput | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const signature = JSON.stringify([action, input, snapshot.revision]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const updated = await mutate(action, input, snapshot.revision, attempt.current.key);
      setSnapshot(updated);
      setEditing(false);
      setConflict(false);
      setFormKey((key) => key + 1);
      attempt.current = null;
      setNotice(
        action === "start" ? "Closing started against the approved terms." : "Funding recorded.",
      );
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        failure &&
        typeof failure === "object" &&
        "code" in failure &&
        failure.code === "REVISION_CONFLICT"
      )
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await reload());
      setEditing(false);
      setConflict(false);
      setFormKey((key) => key + 1);
      attempt.current = null;
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const terms = current.approvedTerms;
  const closingReadiness = {
    ...current.readiness,
    gates: current.readiness.gates.filter((gate) => gate.stage === "closing"),
  };
  return (
    <div
      className={`grid items-start gap-6 ${current.account ? "" : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"}`}
    >
      <div className="space-y-6">
        {current.account && <FundedAccountCard account={current.account} />}
        <Card className="ring-0 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                <h2>{current.account ? "Completed closing" : "Closing and funding"}</h2>
              </CardTitle>
            </div>
            <CardDescription>
              {current.account
                ? "The completed closing record remains linked to this application and its approved terms."
                : current.status === "closing"
                  ? "Complete the current closing requirements before a staff member records funding."
                  : current.status === "approved"
                    ? "A staff member can start closing against the approved terms. Approval does not record funding."
                    : "Closing becomes available after an explicit bank approval."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {(error || stale) && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>
                  {stale ? "This application changed" : "The action could not be recorded"}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {error ??
                      "A newer application revision is available. Your entered funding details have been preserved."}
                  </p>
                  {stale && (
                    <>
                      <p>
                        Reload the current application before retrying. Reloading replaces unsaved
                        entries.
                      </p>
                      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                        Reload current application
                      </Button>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            {terms && !current.account && (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Approved amount</dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight">
                    {exactUsd(terms.approvedAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Product</dt>
                  <dd className="mt-1">{workflowText(terms.productName)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Business</dt>
                  <dd className="mt-1 break-words">{workflowName(terms.businessName)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Approval recorded</dt>
                  <dd className="mt-1">
                    <time dateTime={terms.approvedAt}>
                      {new Date(terms.approvedAt).toLocaleString()}
                    </time>
                  </dd>
                </div>
              </dl>
            )}
            {current.capabilities.startClosing && (
              <Button
                loading={busy}
                disabled={busy || stale}
                onClick={() => void perform("start", null)}
              >
                Start closing
              </Button>
            )}
            {current.package && (
              <p className="text-xs leading-5 text-muted-foreground">
                Closing package {current.package.revision} · This product records one funding event
                for exactly the approved amount. Approved terms are fixed.
              </p>
            )}
            <a className="inline-flex text-sm underline underline-offset-4" href={reviewHref}>
              View approval and submission history
            </a>
          </CardContent>
        </Card>
        {current.package && (
          <Card className="ring-0 shadow-sm">
            <CardHeader>
              <CardTitle>
                <h2>Closing conditions</h2>
              </CardTitle>
              <CardDescription>
                Task evidence and signatures must be current. A completed signature request does not
                record funding by itself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-6">
                {current.conditions.map((condition) => (
                  <li
                    key={condition.id}
                    aria-label={`Closing condition ${workflowText(condition.title)}`}
                    className="space-y-2"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="text-sm font-medium">{workflowText(condition.title)}</h3>
                      <Badge variant={condition.passes ? "secondary" : "outline"}>
                        {condition.passes
                          ? "Satisfied"
                          : condition.required
                            ? "Required"
                            : "Optional"}
                      </Badge>
                    </div>
                    {condition.kind === "signature" && (
                      <p className="text-sm text-muted-foreground">
                        {condition.signatureState
                          ? (signatureStates[condition.signatureState] ??
                            "Signature status unavailable")
                          : "A signature request is needed."}
                        {condition.signatureState === "completed" && !condition.passes
                          ? " Current signature evidence still needs attention."
                          : ""}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm">
                      <a className="underline underline-offset-4" href={taskHref(condition.taskId)}>
                        View task
                      </a>
                      {condition.kind === "signature" && (
                        <a
                          className="underline underline-offset-4"
                          href={signatureHref(condition.signatureEnvelopeId)}
                        >
                          {condition.signatureEnvelopeId
                            ? "View signature request"
                            : current.canManage
                              ? "Prepare signature request"
                              : "View signature requests"}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {current.canManage && current.status === "closing" && terms && !current.account && (
          <Card className="ring-0 shadow-sm">
            <CardHeader>
              <CardTitle>
                <h2>Record funding</h2>
              </CardTitle>
              <CardDescription>
                A deliberate staff action creates one funding record and one account. No payment
                rail is called.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FundingForm
                key={formKey}
                amount={terms.approvedAmount}
                approvedAt={terms.approvedAt}
                allowed={current.capabilities.recordFunding}
                busy={busy}
                stale={stale}
                onEditing={setEditing}
                save={(input) => perform("fund", input)}
              />
            </CardContent>
          </Card>
        )}
      </div>
      {!current.account && <ReadinessPanel data={closingReadiness} />}
    </div>
  );
}

function FundingForm({
  amount,
  approvedAt,
  allowed,
  busy,
  stale,
  onEditing,
  save,
}: {
  amount: string;
  approvedAt: string;
  allowed: boolean;
  busy: boolean;
  stale: boolean;
  onEditing: (value: boolean) => void;
  save: (input: FundingInput) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [fundedOn, setFundedOn] = useState(today);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const dirty = reference !== "" || fundedOn !== today || confirmed;
  useEffect(() => onEditing(dirty), [dirty, onEditing]);
  return (
    <form
      aria-label="Record funding"
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!allowed || !confirmed || busy || stale || !reference.trim()) return;
        await save({
          fundedAmount: amount,
          fundedOn,
          reference: reference.trim(),
          humanFundingConfirmed: true,
        });
      }}
    >
      {!allowed && (
        <p role="status" className="text-sm text-muted-foreground">
          Funding is unavailable until all current closing requirements are satisfied.
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="funded-amount" className="text-sm font-medium">
          Recorded funded amount (USD)
        </label>
        <Input id="funded-amount" value={amount} readOnly />
        <p className="text-xs text-muted-foreground">
          Exactly the approved amount, as required by this product.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="funded-on" className="text-sm font-medium">
            Funding date (UTC)
          </label>
          <Input
            id="funded-on"
            type="date"
            required
            value={fundedOn}
            min={approvedAt.slice(0, 10)}
            max={today}
            disabled={busy || stale}
            onChange={(event) => setFundedOn(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="funding-reference" className="text-sm font-medium">
            Funding reference
          </label>
          <Input
            id="funding-reference"
            required
            maxLength={100}
            value={reference}
            disabled={busy || stale}
            placeholder="FUNDING-001"
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm leading-6">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || stale}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        I confirm the closing requirements were reviewed and the funding details are correct.
      </label>
      <Button
        loading={busy}
        type="submit"
        disabled={busy || stale || !allowed || !confirmed || !reference.trim() || !fundedOn}
      >
        Record funding
      </Button>
    </form>
  );
}
