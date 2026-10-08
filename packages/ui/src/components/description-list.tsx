import { cn } from "cn";
import type { ReactNode } from "react";

/** Responsive label/value grid used for application, business and loan facts. */
export function DescriptionList({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-5",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function DescriptionItem({
  label,
  children,
  className,
  wide = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-full", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm leading-6 break-words text-foreground">{children}</dd>
    </div>
  );
}
