import type { ApplicationPortal } from "@keycade/contracts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { cn } from "@keycade/ui/lib/utils";
import { workflowText } from "@keycade/ui/lib/workflow-text";
import { Check, ChevronDown, History, Minus } from "lucide-react";
import { applicationProgress, lifecycleLabels, type ProgressStep } from "./application-progress";

const stateText: Record<ProgressStep["state"], string> = {
  complete: "Completed",
  current: "Current",
  stopped: "Stopped",
  previous: "Previously reached",
  upcoming: "Upcoming",
};

function StepMarker({ state }: { state: ProgressStep["state"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card",
        state === "complete" && "border-success bg-success text-white",
        state === "current" && "border-info bg-info-soft ring-4 ring-info-soft/60",
        state === "previous" && "border-border bg-muted text-muted-foreground",
        state === "stopped" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {state === "complete" ? (
        <Check className="size-3.5" strokeWidth={3} />
      ) : state === "current" ? (
        <span className="size-2 rounded-full bg-info" />
      ) : state === "previous" ? (
        <History className="size-3" />
      ) : state === "stopped" ? (
        <Minus className="size-3.5" />
      ) : null}
    </span>
  );
}

export function ApplicationTimeline({ application }: { application: ApplicationPortal }) {
  const steps = applicationProgress(application);
  return (
    <Collapsible className="group/progress rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold hover:bg-muted/40">
        Application progress
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open/progress:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t px-4 py-4">
          <ol aria-label="Application stages">
            {steps.map((step, index) => (
              <li
                key={step.key}
                aria-current={step.state === "current" ? "step" : undefined}
                className="relative flex gap-3 pb-5 last:pb-0"
              >
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-6 bottom-0 left-[11.5px] w-px",
                      step.state === "complete" ? "bg-success/45" : "bg-border",
                    )}
                  />
                )}
                <StepMarker state={step.state} />
                <div className="min-w-0 space-y-0.5 pt-0.5">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      step.state === "upcoming" && "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {stateText[step.state]} · {workflowText(step.description)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {application.timelineEvents.length > 0 && (
            <Collapsible className="group/history rounded-md bg-muted/50 px-3 py-2">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium">
                Stage history
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-data-open/history:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-3 space-y-3 pb-1 text-xs text-muted-foreground">
                  {application.timelineEvents.map((event) => (
                    <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                      <p className="font-medium text-foreground">{lifecycleLabels[event.status]}</p>
                      <time dateTime={event.createdAt}>
                        {new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(event.createdAt))}
                      </time>
                    </li>
                  ))}
                </ol>
              </CollapsibleContent>
            </Collapsible>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Progress reflects the saved application stage. Task completion does not guarantee
            approval.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
