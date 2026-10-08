import { Badge } from "@keycade/ui/components/badge";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type StatusTone = "neutral" | "brand" | "info" | "success" | "warning" | "danger";

const toneVariant = {
  neutral: "secondary",
  brand: "brand",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "destructive",
} as const;

const dotColor: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/70",
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * A status label with a tone. Text always carries the meaning; the tone and its dot or
 * icon only reinforce it, so status never relies on color alone.
 */
export function StatusPill({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={toneVariant[tone]} className={cn("max-w-full", className)}>
      {Icon ? (
        <Icon aria-hidden="true" data-icon="inline-start" />
      ) : (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotColor[tone])} />
      )}
      <span className="truncate">{children}</span>
    </Badge>
  );
}

const textColor: Record<StatusTone, string> = {
  neutral: "text-foreground",
  brand: "text-brand",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/** Compact, wrapping status for dense tables: a toned dot followed by the label. */
export function StatusText({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-start gap-2 font-medium", textColor[tone], className)}>
      <span
        aria-hidden="true"
        className={cn("mt-2 size-2 shrink-0 rounded-full", dotColor[tone])}
      />
      <span>{children}</span>
    </span>
  );
}

/** Shared tone for an application lifecycle status in both workspaces. */
export function applicationStatusTone(status: string): StatusTone {
  switch (status) {
    case "approved":
    case "funded":
      return "success";
    case "needs_information":
      return "warning";
    case "declined":
      return "danger";
    case "submitted":
    case "in_review":
      return "info";
    case "collecting_information":
    case "closing":
      return "brand";
    default:
      return "neutral";
  }
}
