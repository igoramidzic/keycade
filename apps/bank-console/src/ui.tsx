import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import type { ReactNode } from "react";
import { ApiError } from "./api";

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>We couldn’t complete that request</AlertTitle>
      <AlertDescription>
        <p>
          {error instanceof ApiError
            ? error.message
            : "We couldn’t connect. Your entered values are still here. Please try again."}
        </p>
        {error instanceof ApiError && error.status === 409 && (
          <p>
            The record changed. Your entered values are still here. Reloading replaces your edits
            with the latest saved record; review it before retrying.
          </p>
        )}
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Loading({ children = "Loading applications…" }: { children?: ReactNode }) {
  return (
    <p role="status" className="py-10 text-center text-muted-foreground">
      {children}
    </p>
  );
}
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
export const statusLabels: Record<string, string> = {
  draft: "Draft",
  collecting_information: "Collecting information",
  submitted: "Submitted",
  in_review: "In review",
  needs_information: "Needs information",
  approved: "Approved",
  declined: "Declined",
  closing: "Closing",
  funded: "Funded",
  withdrawn: "Withdrawn",
};
export const stepLabels: Record<string, string> = {
  business_name: "Business name",
  product: "Requested amount",
  amount: "Requested amount",
  purpose: "Purpose",
  industry: "Industry",
  review: "Review answers",
};
export function SetupBadge({ status }: { status: "in_progress" | "completed" }) {
  return (
    <Badge variant={status === "completed" ? "secondary" : "outline"}>
      {status === "completed" ? "Setup complete" : "Setup incomplete"}
    </Badge>
  );
}
export const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
