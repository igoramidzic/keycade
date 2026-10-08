import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import { LoadingState } from "@keycade/ui/components/empty-state";
import type { StatusTone } from "@keycade/ui/components/status-pill";
import { textareaClassName } from "@keycade/ui/components/textarea";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "./api";

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden="true" />
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
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Loading({ children = "Loading applications…" }: { children?: ReactNode }) {
  return <LoadingState>{children}</LoadingState>;
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
  business_name: "Legal business name",
  business_address: "Business address",
  business_ein: "Business EIN (optional)",
  website: "Website (optional)",
  other_purpose: "Other purpose details (optional)",
  product: "Requested amount",
  amount: "Requested amount",
  purpose: "Purpose",
  industry: "Industry",
  review: "Review answers",
};
const setupTone: Record<"in_progress" | "completed", StatusTone> = {
  in_progress: "warning",
  completed: "success",
};
export function SetupBadge({ status }: { status: "in_progress" | "completed" }) {
  return (
    <Badge variant={setupTone[status] === "success" ? "success" : "warning"}>
      {status === "completed" ? "Setup complete" : "Setup incomplete"}
    </Badge>
  );
}
export const textareaClass = textareaClassName;
