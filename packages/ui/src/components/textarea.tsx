import { cn } from "cn";
import * as React from "react";

/** Shared multi-line field styling for plain <textarea> elements that predate this component. */
export const textareaClassName =
  "flex min-h-28 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base leading-6 shadow-xs transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground/80 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("field-sizing-content min-h-16", textareaClassName, className)}
      {...props}
    />
  );
}

export { Textarea };
