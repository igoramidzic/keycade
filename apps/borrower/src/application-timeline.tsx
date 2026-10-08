import type { ApplicationPortal } from "@keycade/contracts";
import { applicationProgress, lifecycleLabels } from "./application-progress";

export function ApplicationTimeline({ application }: { application: ApplicationPortal }) {
  return (
    <details className="rounded-lg border bg-background p-4">
      <summary className="cursor-pointer text-sm font-medium">Application progress</summary>
      <div className="mt-4 space-y-5">
        <ol aria-label="Application stages" className="space-y-4">
          {applicationProgress(application).map((step) => (
            <li key={step.key} aria-current={step.state === "current" ? "step" : undefined}>
              <div className="flex gap-3">
                <span aria-hidden="true" className="mt-0.5 text-sm text-muted-foreground">
                  {step.state === "complete"
                    ? "✓"
                    : step.state === "current"
                      ? "●"
                      : step.state === "stopped"
                        ? "−"
                        : "○"}
                </span>
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.state === "complete"
                      ? "Completed"
                      : step.state === "current"
                        ? "Current"
                        : step.state === "stopped"
                          ? "Stopped"
                          : step.state === "previous"
                            ? "Previously reached"
                            : "Upcoming"}{" "}
                    · {step.description}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        {application.timelineEvents.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Stage history</summary>
            <ol className="mt-3 space-y-3 text-xs text-muted-foreground">
              {application.timelineEvents.map((event) => (
                <li key={event.id}>
                  <p>{lifecycleLabels[event.status]}</p>
                  <time dateTime={event.createdAt}>
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(event.createdAt))}
                  </time>
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="text-xs text-muted-foreground">
          Progress reflects the saved application stage. Task completion does not guarantee
          approval. Funding is simulated.
        </p>
      </div>
    </details>
  );
}
