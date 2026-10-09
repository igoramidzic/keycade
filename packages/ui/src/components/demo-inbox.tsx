import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  subject: string;
  receivedAt: string;
  applicationReference: string | null;
  state: "available" | "consumed" | "expired" | "unavailable";
};
type Detail = Message & { text: string; confirmUrl: string | null };
export function DemoInbox({
  messages,
  refreshing,
  refresh,
  open,
}: {
  messages: Message[];
  refreshing: boolean;
  refresh(): void;
  open(id: string, signal: AbortSignal): Promise<Detail>;
}) {
  const [selected, setSelected] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function read(id: string, confirm = false) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(false);
    try {
      const message = await open(id, controller.signal);
      if (controller.signal.aborted) return;
      // Keep bearer credentials out of rendered text and component state.
      setSelected({ ...message, confirmUrl: null });
      if (confirm && message.confirmUrl) {
        const target = new URL(message.confirmUrl);
        if (
          !["http:", "https:"].includes(target.protocol) ||
          target.pathname !== "/auth/confirm" ||
          target.username ||
          target.password ||
          !/^#token=[a-f0-9]{64}$/.test(target.hash)
        )
          throw new Error("Invalid confirmation.");
        window.location.assign(target.href);
      }
    } catch {
      if (!controller.signal.aborted) {
        setError(true);
        setSelected(null);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Card className="ring-0 shadow-sm">
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <CardTitle>
            <h1>Inbox</h1>
          </CardTitle>
          <CardDescription>Messages and sign-in links for your current account.</CardDescription>
        </div>
        <Button
          loading={refreshing}
          variant="outline"
          disabled={refreshing || busy}
          onClick={refresh}
        >
          Refresh inbox
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            This message is unavailable. Refresh the inbox and try again.
          </p>
        )}
        {!messages.length ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Requested links can take a few seconds to appear.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Messages">
            {messages.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void read(message.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-left hover:bg-muted ${selected?.id === message.id ? "bg-muted" : ""}`}
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium">
                      {workflowText(message.subject)}
                    </span>
                    <time
                      dateTime={message.receivedAt}
                      className="block text-xs text-muted-foreground"
                    >
                      {new Date(message.receivedAt).toLocaleString()}
                    </time>
                  </span>
                  <Badge variant="secondary">
                    {message.state === "available"
                      ? "Ready"
                      : message.state === "consumed"
                        ? "Used"
                        : message.state === "expired"
                          ? "Expired"
                          : "Unavailable"}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <section aria-label="Selected message" className="space-y-4 rounded-lg bg-muted p-4">
            <h2 className="text-base font-semibold">{workflowText(selected.subject)}</h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {workflowText(selected.text)}
            </p>
            {selected.state === "available" ? (
              <Button loading={busy} disabled={busy} onClick={() => void read(selected.id, true)}>
                Open confirmation
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                This link is{" "}
                {selected.state === "consumed" ? "already used" : "no longer available"}. You can
                request a fresh link.
              </p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
