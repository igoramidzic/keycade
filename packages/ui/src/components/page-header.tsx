import { cn } from "cn";
import type { ReactNode } from "react";

/** Class for quiet "back to" navigation links that sit above a page title. */
export const backLinkClassName =
  "group/back inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Primary page heading with optional eyebrow, supporting copy, metadata and actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
  titleId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl space-y-2">
        {eyebrow && <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>}
        <h1
          id={titleId}
          className="text-[1.75rem] leading-tight font-semibold tracking-tight break-words sm:text-[2rem]"
        >
          {title}
        </h1>
        {description && (
          <div className="text-sm leading-6 text-pretty text-muted-foreground">{description}</div>
        )}
        {meta && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">{meta}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Heading row for a section that is not itself a card. */
export function SectionHeading({
  title,
  description,
  actions,
  as: Heading = "h2",
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 space-y-1">
        <Heading id={id} className="text-lg font-semibold tracking-tight break-words">
          {title}
        </Heading>
        {description && (
          <p className="text-sm leading-6 text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
