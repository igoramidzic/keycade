import type { ApplicationSetupStep } from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button } from "@keycade/ui/components/button";
import { LoadingState } from "@keycade/ui/components/empty-state";
import { CircleAlert } from "lucide-react";
import { ApiError, errorMessage } from "./api";

export const applicationPath = (id: string, bank: string, setup = false) =>
  `/applications/${id}${setup ? "/setup" : ""}?bank=${encodeURIComponent(bank)}`;
const setupSteps: readonly ApplicationSetupStep[] = [
  "business_name",
  "business_address",
  "business_ein",
  "industry",
  "website",
  "amount",
  "purpose",
  "other_purpose",
  "review",
];
/** Each setup question has its own address, such as /applications/:id/setup/business-name. */
export const setupStepPath = (id: string, bank: string, step: ApplicationSetupStep) =>
  `/applications/${id}/setup/${step.replaceAll("_", "-")}?bank=${encodeURIComponent(bank)}`;
export const setupStepFromSlug = (slug: string | undefined) =>
  setupSteps.find((step) => step.replaceAll("_", "-") === slug) ?? null;
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>We couldn’t complete that step</AlertTitle>
      <AlertDescription>
        <p>
          {error instanceof ApiError
            ? errorMessage(error)
            : "We couldn’t connect. Please try again."}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Loading() {
  return <LoadingState>Loading your application…</LoadingState>;
}
