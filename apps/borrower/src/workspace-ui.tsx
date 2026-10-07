import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button } from "@keycade/ui/components/button";
import { ApiError, errorMessage } from "./api";

export const applicationPath = (id: string, bank: string, setup = false) =>
  `/applications/${id}${setup ? "/setup" : ""}?bank=${encodeURIComponent(bank)}`;
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>We couldn’t complete that step</AlertTitle>
      <AlertDescription>
        <p>
          {error instanceof ApiError
            ? errorMessage(error)
            : "We couldn’t connect. Please try again."}
        </p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Loading() {
  return (
    <p role="status" className="py-10 text-center text-muted-foreground">
      Loading your application…
    </p>
  );
}
