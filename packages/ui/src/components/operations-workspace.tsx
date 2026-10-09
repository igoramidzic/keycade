import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

type Action =
  | "retry_scan"
  | "retry_processing"
  | "retry_check"
  | "retry_signature"
  | "void_signature"
  | "retry_notification";
type Item = {
  id: string;
  resourceId: string;
  runId: string | null;
  kind: string;
  title: string;
  status: string;
  stale: boolean;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  actions: Action[];
};
type Data = {
  worker: { state: string; lastSeenAt: string | null };
  backlog: { pending: number; oldestAt: string | null; overdue: number };
  items: Item[];
};
export function OperationsWorkspace({
  data,
  refreshing,
  refresh,
  mutate,
}: {
  data: Data;
  refreshing: boolean;
  refresh(): void;
  mutate(command: { action: Action; resourceId: string; runId?: string }): Promise<unknown>;
}) {
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  async function act(item: Item, action: Action) {
    setBusy(item.id);
    setError(null);
    setStatus(null);
    try {
      await mutate({
        action,
        resourceId: item.resourceId,
        ...(item.runId ? { runId: item.runId } : {}),
      });
      setConfirm(null);
      setStatus(
        action === "void_signature"
          ? "Signature request voided."
          : "Retry requested. The worker will process the current operation.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "This operation changed. Refresh and try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  const attention = (item: Item) =>
    item.stale ||
    [
      "failed",
      "timed_out",
      "error",
      "delivery_failed",
      "waiting_for_input",
      "needs_review",
    ].includes(item.status);
  const items = data.items.filter(
    (item) => filter === "all" || (filter === "attention" ? attention(item) : item.kind === filter),
  );
  const state = (item: Item) =>
    item.stale
      ? "Superseded"
      : ({
          not_sent: "Ready to send",
          retry_scheduled: "Retry scheduled",
          waiting_for_input: "Waiting for input",
          delivery_failed: "Delivery failed",
          needs_review: "Needs review",
        }[item.status] ?? item.status.replaceAll("_", " "));
  return (
    <section
      className="space-y-6 rounded-xl bg-card p-5 shadow-sm sm:p-6"
      aria-label="Background operations"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Background operations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Work for this application. Retries use current permissions and inputs.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={refreshing || !!busy} onClick={refresh}>
          Refresh operations
        </Button>
      </div>
      <dl className="grid gap-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Worker</dt>
          <dd className="mt-1 font-medium">
            {data.worker.state === "healthy"
              ? "Responding"
              : data.worker.state === "offline"
                ? "Not responding"
                : "No heartbeat yet"}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {data.worker.lastSeenAt
              ? `Last seen ${new Date(data.worker.lastSeenAt).toLocaleString()}`
              : "Queued work will wait for a worker."}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pending work</dt>
          <dd className="mt-1 text-2xl font-semibold">{data.backlog.pending}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Waiting over 5 minutes</dt>
          <dd className="mt-1 text-2xl font-semibold">{data.backlog.overdue}</dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <label className="flex flex-wrap items-center gap-3 text-sm">
        Show
        <select
          aria-label="Show operations"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-9 rounded-lg border bg-background px-3"
        >
          <option value="all">All operations</option>
          <option value="attention">Needs attention</option>
          <option value="document_scan">Document scans</option>
          <option value="document_processing">Document interpretation</option>
          <option value="check">Checks</option>
          <option value="signature">Signing</option>
          <option value="notification">Messages</option>
        </select>
      </label>
      {!items.length ? (
        <p className="text-sm text-muted-foreground">No operations in this view.</p>
      ) : (
        <ul className="space-y-5">
          {items.map((item) => (
            <li key={item.id} className="space-y-3 rounded-lg bg-muted/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{workflowText(item.title)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()} · {item.attempts} attempts
                  </p>
                </div>
                <Badge variant={attention(item) ? "outline" : "secondary"} className="capitalize">
                  {state(item)}
                </Badge>
              </div>
              {item.errorCode && (
                <p className="break-words text-xs text-muted-foreground">
                  {item.errorCode.replaceAll("_", " ")}
                </p>
              )}
              <Collapsible className="text-xs text-muted-foreground">
                <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 w-full text-left">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
                  />
                  Operation reference
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <code className="mt-1 block break-all">{item.runId ?? item.resourceId}</code>
                </CollapsibleContent>
              </Collapsible>
              {!!item.actions.length && (
                <div className="flex flex-wrap gap-2">
                  {item.actions.map((action) =>
                    action === "void_signature" ? (
                      <div key={action} className="space-y-2">
                        {confirm === item.id ? (
                          <>
                            <p className="text-xs">
                              Void this signature request? A new request will be needed to collect
                              signatures.
                            </p>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="destructive"
                                disabled={!!busy}
                                onClick={() => void act(item, action)}
                              >
                                Confirm void
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={!!busy}
                                onClick={() => setConfirm(null)}
                              >
                                Keep request
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!!busy}
                            onClick={() => setConfirm(item.id)}
                          >
                            Void signature request
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        loading={busy === item.id}
                        key={action}
                        type="button"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => void act(item, action)}
                      >
                        Retry operation
                      </Button>
                    ),
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
