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
import { NativeSelect } from "@keycade/ui/components/native-select";
import { useEffect, useState } from "react";

type Envelope = {
  id: string;
  taskTitle: string;
  sourceFileName: string;
  sourceVersionId: string;
  state: "draft" | "sent" | "partially_signed" | "completed" | "declined" | "expired" | "voided";
  deliveryStatus: "not_sent" | "pending" | "running" | "sent" | "failed";
  sendError: string | null;
  stale: boolean;
  expiresAt: string;
  signers: {
    id: string;
    displayName: string;
    email: string;
    state: "pending" | "signed" | "declined";
  }[];
  canSign: boolean;
  canDecline: boolean;
  canSend: boolean;
  canVoid: boolean;
  canDownloadArtifact: boolean;
};
export type SignaturesData = { canCreate: boolean; envelopes: Envelope[] };
export type SignatureChoices = {
  tasks: { id: string; title: string }[];
  sources: { id: string; fileName: string }[];
  signers: { id: string; displayName: string; email: string }[];
};
const states: Record<Envelope["state"], string> = {
  draft: "Draft",
  sent: "Sent",
  partially_signed: "Partially signed",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
};
const delivery: Record<Envelope["deliveryStatus"], string> = {
  not_sent: "Not sent",
  pending: "Send queued",
  running: "Sending",
  sent: "Sent in demo",
  failed: "Send failed",
};
export function SignaturesManager({
  data,
  choices,
  create,
  act,
  download,
  downloadSource,
  errorMessage,
}: {
  data: SignaturesData;
  choices?: SignatureChoices;
  create?: (body: {
    taskId: string;
    sourceVersionId: string;
    signerParticipantIds: string[];
    idempotencyKey: string;
    scenario: string;
  }) => Promise<unknown>;
  act: (id: string, action: "send" | "void" | "sign" | "decline") => Promise<unknown>;
  download: (id: string) => Promise<unknown>;
  downloadSource: (versionId: string, fileName: string) => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (/^envelope-[0-9a-f-]{36}$/i.test(target))
      document.getElementById(target)?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div className="space-y-6">
      <Card className="ring-0 shadow-sm">
        <CardHeader>
          <CardTitle>
            <h2>Simulated signatures</h2>
          </CardTitle>
          <CardDescription>
            Requests and signed artifacts are fictional. They have no legal effect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {data.envelopes.length ? (
            data.envelopes.map((envelope) => (
              <SignatureRequest
                key={envelope.id}
                envelope={envelope}
                act={(action) => act(envelope.id, action)}
                download={() => download(envelope.id)}
                downloadSource={() =>
                  downloadSource(envelope.sourceVersionId, envelope.sourceFileName)
                }
                errorMessage={errorMessage}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No signature requests are available to your account.
            </p>
          )}
        </CardContent>
      </Card>
      {data.canCreate && choices && create && (
        <CreateRequest choices={choices} create={create} errorMessage={errorMessage} />
      )}
    </div>
  );
}
function SignatureRequest({
  envelope,
  act,
  download,
  downloadSource,
  errorMessage,
}: {
  envelope: Envelope;
  act: (action: "send" | "void" | "sign" | "decline") => Promise<unknown>;
  download: () => Promise<unknown>;
  downloadSource: () => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      setConsent(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id={`envelope-${envelope.id}`}
      aria-label={`Signature request ${envelope.taskTitle}`}
      className="space-y-4 py-1"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold tracking-tight">{envelope.taskTitle}</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            Source: {envelope.sourceFileName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(downloadSource, "Source document downloaded.")}
          >
            View source document
          </Button>
          <Badge variant="secondary">{states[envelope.state]}</Badge>
          <span className="text-xs text-muted-foreground">{delivery[envelope.deliveryStatus]}</span>
          {envelope.stale && <Badge variant="outline">Outdated source</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Expires {new Date(envelope.expiresAt).toLocaleString()} · Simulated
      </p>
      {envelope.stale && (
        <p className="text-sm text-muted-foreground">
          The source, task evidence, or signer access changed. This request cannot complete current
          work; staff must create a new request.
        </p>
      )}
      {envelope.sendError && (
        <p className="text-sm text-muted-foreground">
          The simulated delivery failed. Staff can retry when the request is still current.
        </p>
      )}
      <ul className="space-y-2 text-sm" aria-label="Intended signers">
        {envelope.signers.map((signer) => (
          <li className="flex flex-wrap justify-between gap-2" key={signer.id}>
            <span className="break-all">
              {signer.displayName} · {signer.email}
            </span>
            <span>
              {signer.state === "signed"
                ? "Signed in demo"
                : signer.state === "declined"
                  ? "Declined"
                  : "Awaiting signature"}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Signature action incomplete</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {envelope.canSign && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={busy}
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          I understand this is a simulated signature with no legal effect.
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {envelope.canSign && (
          <Button
            size="sm"
            disabled={busy || !consent}
            onClick={() => void run(() => act("sign"), "Your simulated signature was recorded.")}
          >
            Sign in demo
          </Button>
        )}
        {envelope.canDecline && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => act("decline"), "You declined this simulated request.")}
          >
            Decline request
          </Button>
        )}
        {envelope.canSend && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => act("send"), "Simulated delivery was requested.")}
          >
            {envelope.deliveryStatus === "failed" ? "Retry sending" : "Send request"}
          </Button>
        )}
        {envelope.canVoid && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => act("void"), "This simulated request was voided.")}
          >
            Void request
          </Button>
        )}
        {envelope.canDownloadArtifact && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(download, "Synthetic signed artifact downloaded.")}
          >
            Download simulated artifact
          </Button>
        )}
      </div>
    </section>
  );
}
function CreateRequest({
  choices,
  create,
  errorMessage,
}: {
  choices: SignatureChoices;
  create: NonNullable<Parameters<typeof SignaturesManager>[0]["create"]>;
  errorMessage: (error: unknown) => string;
}) {
  const [taskId, setTaskId] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [signers, setSigners] = useState<string[]>([]);
  const [scenario, setScenario] = useState("success");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ payload: string; key: string } | null>(null);
  return (
    <Card className="ring-0 shadow-sm">
      <CardHeader>
        <CardTitle>
          <h2>Create a signature request</h2>
        </CardTitle>
        <CardDescription>
          Select current clean evidence and the intended participants. Every signer must already
          have access to the task and source.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setNotice(null);
            const payload = JSON.stringify({ taskId, sourceVersionId, signers, scenario });
            const key = attempt?.payload === payload ? attempt.key : crypto.randomUUID();
            setAttempt({ payload, key });
            try {
              await create({
                taskId,
                sourceVersionId,
                signerParticipantIds: signers,
                scenario,
                idempotencyKey: key,
              });
              setTaskId("");
              setSourceVersionId("");
              setSigners([]);
              setAttempt(null);
              setNotice("Simulated request created. Send it when ready.");
            } catch (failure) {
              setError(errorMessage(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Request not created</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="signature-task" className="text-sm">
                Signature task
              </label>
              <NativeSelect
                id="signature-task"
                required
                value={taskId}
                disabled={busy}
                onChange={(event) => setTaskId(event.target.value)}
              >
                <option value="">Choose a task</option>
                {choices.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label htmlFor="signature-source" className="text-sm">
                Current document
              </label>
              <NativeSelect
                id="signature-source"
                required
                value={sourceVersionId}
                disabled={busy}
                onChange={(event) => setSourceVersionId(event.target.value)}
              >
                <option value="">Choose clean evidence</option>
                {choices.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.fileName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Intended signers</legend>
            {choices.signers.map((signer) => (
              <label className="flex items-start gap-2 text-sm" key={signer.id}>
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={signers.includes(signer.id)}
                  onChange={(event) =>
                    setSigners(
                      event.target.checked
                        ? [...signers, signer.id]
                        : signers.filter((id) => id !== signer.id),
                    )
                  }
                />
                <span className="break-all">
                  {signer.displayName} · {signer.email}
                </span>
              </label>
            ))}
            {!choices.signers.length && (
              <p className="text-sm text-muted-foreground">No active participants are available.</p>
            )}
          </fieldset>
          <div className="space-y-2">
            <label htmlFor="signature-scenario" className="text-sm">
              Simulated delivery scenario
            </label>
            <NativeSelect
              id="signature-scenario"
              value={scenario}
              disabled={busy}
              onChange={(event) => setScenario(event.target.value)}
            >
              <option value="success">Successful delivery</option>
              <option value="transient_error">Temporary error, then retry</option>
              <option value="terminal_error">Failed delivery</option>
            </NativeSelect>
          </div>
          <Button
            type="submit"
            disabled={busy || !taskId || !sourceVersionId || signers.length === 0}
          >
            Create simulated request
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
