import { cn } from "cn";
import { FlaskConical, Info, Upload } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Small building blocks shared by the demo kit and its text importer. They render inside the
 * `dark demo-kit` scope (see `globals.css`), so they read the console palette through the
 * ordinary semantic tokens plus the amber `demo-accent`.
 */

/** Amber "Demo only" marker that labels simulation tooling. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-demo-accent px-2 text-xs font-semibold text-demo-accent-foreground",
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      Demo only
    </span>
  );
}

/** Numbered section heading, so the kit reads as the order a presenter uses it. */
export function DemoStepHeading({
  id,
  step,
  title,
  hint,
}: {
  id: string;
  step: number;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-demo-accent text-xs font-semibold text-demo-accent-foreground tabular-nums"
      >
        {step}
      </span>
      <div className="min-w-0 space-y-0.5">
        <h3 id={id} className="text-sm leading-6 font-semibold">
          {title}
        </h3>
        {hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Where kit uploads go right now, or what to open to enable them. */
export function DemoDestination({ ready, children }: { ready: boolean; children: string }) {
  const Icon = ready ? Upload : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5",
        ready ? "border-info/40 bg-info/10" : "border-dashed text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", ready && "text-info")} />
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}
