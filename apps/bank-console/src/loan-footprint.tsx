import { type BusinessAddress, checksViewSchema } from "@keycade/contracts";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { cn } from "@keycade/ui/lib/utils";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, useStaffApi } from "./api";
import {
  footprintAddress,
  footprintMapPoint,
  type LoanFootprintCheck,
  loanFootprintDisplay,
} from "./loan-footprint-data";
import { ErrorNotice } from "./ui";

export function LoanFootprintItem({
  applicationId,
  check,
  savedAddress,
  unavailable = false,
}: {
  applicationId: string;
  check: LoanFootprintCheck;
  savedAddress: BusinessAddress | null;
  unavailable?: boolean;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const display = loanFootprintDisplay(check, savedAddress, unavailable);
  useEffect(() => {
    // Checks poll independently of the workspace. A changed address must also refresh its text.
    if (display.stale && !display.run?.stale)
      void client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] });
  }, [applicationId, client, display.stale, display.run?.stale, display.run?.id]);
  return (
    <section aria-label="Loan Footprint" className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
              display.clear ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
            )}
          >
            <MapPin className="size-4" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <Button
              variant="link"
              className="h-auto max-w-full p-0 text-left font-semibold whitespace-normal"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              Loan Footprint
            </Button>
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm",
                display.clear ? "font-medium text-success" : "text-muted-foreground",
              )}
            >
              {display.clear && <CircleCheck aria-hidden="true" className="size-4" />}
              {display.label}
            </p>
          </div>
        </div>
        <Badge variant="outline">Informational</Badge>
      </div>
      {open && (
        <LoanFootprintDialog
          applicationId={applicationId}
          check={check}
          savedAddress={savedAddress}
          unavailable={unavailable}
          close={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function LoanFootprintDialog({
  applicationId,
  check,
  savedAddress,
  unavailable,
  close,
}: {
  applicationId: string;
  check: LoanFootprintCheck;
  savedAddress: BusinessAddress | null;
  unavailable: boolean;
  close: () => void;
}) {
  const api = useStaffApi();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const display = loanFootprintDisplay(check, savedAddress, unavailable);
  const { run, input, result } = display;
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
  async function refresh() {
    if (!run || !input) return;
    setBusy(true);
    setError(null);
    const queryKey = ["staff-checks", applicationId];
    try {
      await client.cancelQueries({ queryKey });
      const updated = await api.participantRequest(
        `/applications/${applicationId}/checks/${check.id}/refresh`,
        checksViewSchema,
        { method: "POST", body: { runId: run.id, expectedAddressRevision: input.addressRevision } },
      );
      client.setQueryData(queryKey, updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] }),
        client.invalidateQueries({ queryKey: ["staff-overview-history", applicationId] }),
      ]);
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) close();
      await client.invalidateQueries({ queryKey });
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
        close();
      }}
      className="fixed inset-0 m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-2xl overflow-hidden rounded-2xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-foreground/40 backdrop:backdrop-blur-[2px] sm:w-[calc(100%-3rem)]"
    >
      <div className="flex max-h-[94dvh] min-w-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b p-4 sm:px-6 sm:py-5">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"
          >
            <MapPin className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
              Geographic Eligibility
            </h2>
            <p id={`${id}-description`} className="text-sm text-muted-foreground">
              Loan Footprint · country check
            </p>
          </div>
          <Button
            ref={closeButton}
            size="sm"
            variant="outline"
            aria-label="Close geographic eligibility"
            onClick={close}
          >
            <X aria-hidden="true" data-icon="inline-start" />
            Close
          </Button>
        </header>
        <div className="min-h-0 min-w-0 space-y-5 overflow-y-auto p-4 sm:p-6">
          <section
            aria-label="Geographic result"
            className={
              display.clear
                ? "rounded-lg border border-success/25 bg-success-soft p-4 text-foreground"
                : "rounded-lg border bg-muted/40 p-4"
            }
          >
            <p
              role="status"
              className={cn(
                "flex items-center gap-2 font-semibold",
                display.clear && "text-success",
              )}
            >
              {display.clear && <CircleCheck aria-hidden="true" className="size-4.5" />}
              {display.label}.
            </p>
            <p className="mt-2 text-sm">{workflowText(display.detail)}</p>
          </section>
          <dl className="grid min-w-0 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 [&_dt]:text-xs [&_dt]:font-medium">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Saved business address</dt>
              <dd className="mt-1 break-words">{footprintAddress(savedAddress)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Country rule</dt>
              <dd className="mt-1">Complete US addresses are within the lending footprint.</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Policy version</dt>
              <dd className="mt-1 break-words">
                {input?.policyVersion === "US-only-demo-v1" ? "US footprint · v1" : "Not available"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Evaluated address revision</dt>
              <dd className="mt-1">
                {result ? result.addressRevision : "Not yet evaluated"}
                {display.stale && result ? " · Stale" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Evaluated time</dt>
              <dd className="mt-1">
                {run?.evidence?.completedAt
                  ? new Date(run.evidence.completedAt).toLocaleString()
                  : "Not yet evaluated"}
              </dd>
            </div>
          </dl>
          <FootprintMap key={run?.id} coordinates={display.coordinates} />
          {display.stale && input && (
            <p className="break-words text-sm text-muted-foreground">
              Previous evaluated address: {footprintAddress(input.address)}. Historical results do
              not apply to the saved address.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            This informational check does not approve or decline a loan or add a submission,
            approval or funding requirement.
          </p>
          {Boolean(error) && <ErrorNotice error={error} />}
          <div className="flex flex-wrap gap-2">
            {check.canRefresh && run && input && (
              <Button
                loading={busy}
                variant="outline"
                disabled={busy || unavailable}
                onClick={() => void refresh()}
              >
                Refresh Loan Footprint
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void client.invalidateQueries({ queryKey: ["staff-checks", applicationId] })
              }
            >
              Reload status
            </Button>
          </div>
          {check.runs.length > 1 && (
            <Collapsible className="rounded-lg border p-3">
              <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
                />
                Previous footprint runs ({check.runs.length - 1})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-3 space-y-4 text-sm">
                  {check.runs
                    .filter((entry) => entry.id !== check.currentRunId)
                    .map((entry) => (
                      <li key={entry.id} className="space-y-1 break-words">
                        <p>
                          Revision {entry.footprintInput?.addressRevision ?? "unknown"} ·{" "}
                          {entry.status.replaceAll("_", " ")} · Historical
                        </p>
                        <p className="text-muted-foreground">
                          {footprintAddress(entry.footprintInput?.address)}
                        </p>
                        <p className="text-muted-foreground">
                          {entry.footprintInput?.policyVersion === "US-only-demo-v1"
                            ? "US footprint · v1"
                            : "Not available"}{" "}
                          · {new Date(entry.updatedAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
    </dialog>
  );
}

function FootprintMap({
  coordinates,
}: {
  coordinates: ReturnType<typeof loanFootprintDisplay>["coordinates"];
}) {
  const [failed, setFailed] = useState(false);
  const point = footprintMapPoint(coordinates);
  if (!point || !coordinates || failed)
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm">
        <p className="font-medium">Map location unavailable</p>
        <p className="mt-2 text-muted-foreground">
          {failed
            ? "The bundled illustration could not load."
            : "No current registered coordinates are available."}{" "}
          The geographic result is determined independently by the saved country.
        </p>
      </div>
    );
  return (
    <figure className="space-y-2">
      <div
        className="relative overflow-hidden rounded-lg border"
        role="img"
        aria-label={`Map with location pin: ${coordinates.label}`}
      >
        <img
          src={new URL("./loan-footprint-map.svg", import.meta.url).href}
          alt=""
          className="block w-full"
          onError={() => setFailed(true)}
        />
        <span
          aria-hidden="true"
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-info shadow-md ring-4 ring-info/25"
          style={{ left: `${point.left}%`, top: `${point.top}%` }}
        />
      </div>
      <figcaption className="break-words text-xs text-muted-foreground">
        Registered fixture pin {coordinates.label}. Bundled schematic; not a street-level location
        or verified address.
      </figcaption>
    </figure>
  );
}
