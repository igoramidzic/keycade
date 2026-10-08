import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

/** Friendly placeholder for a list or region that has nothing to show yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  titleAs: Title = "p",
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  titleAs?: "p" | "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
        </span>
      )}
      <Title className="text-base font-semibold tracking-tight">{title}</Title>
      {description && (
        <div className="mt-1.5 max-w-md text-sm leading-6 text-pretty text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Accessible loading message with a quiet spinner. Keeps its text for assistive tech. */
export function LoadingState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-center justify-center gap-2.5 py-12 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      <span>{children}</span>
    </p>
  );
}
