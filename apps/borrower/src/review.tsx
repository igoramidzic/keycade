import { reviewReasonLabels, reviewViewSchema } from "@keycade/contracts";
import { buttonVariants } from "@keycade/ui/components/button";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { ReviewManager } from "@keycade/ui/components/review-manager";
import { readinessRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { reviewCommand, reviewReasons } from "@keycade/ui/lib/review-actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

export function useApplicationReview(session: AuthenticatedSession, applicationId: string) {
  return useQuery({
    queryKey: ["review", session.bank.id, session.user.email, applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/review`,
        reviewViewSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : readinessRefreshInterval(query.state.data?.readiness),
  });
}

export function ApplicationReview({
  session,
  applicationId,
  hideForbidden = false,
}: {
  session: AuthenticatedSession;
  applicationId: string;
  hideForbidden?: boolean;
}) {
  const review = useApplicationReview(session, applicationId);
  const client = useQueryClient();
  if (review.isPending || !review.isFetchedAfterMount) return <Loading />;
  const forbidden =
    review.error instanceof ApiError && [401, 403, 404].includes(review.error.status);
  if (forbidden && hideForbidden) return null;
  if (review.error && (!review.data || forbidden))
    return <ErrorNotice error={review.error} onRetry={() => void review.refetch()} />;
  if (!review.data) return null;
  return (
    <div className="space-y-4">
      {review.error && <ErrorNotice error={review.error} onRetry={() => void review.refetch()} />}
      {["approved", "closing", "funded"].includes(review.data.status) && (
        <a
          className={buttonVariants({ variant: "outline" })}
          href={`/applications/${applicationId}/closing?bank=${encodeURIComponent(session.bank.slug)}`}
        >
          {review.data.status === "funded" ? "View funded account" : "View closing requirements"}
        </a>
      )}
      <ReviewManager
        data={review.data}
        reasons={reviewReasons(reviewReasonLabels)}
        taskHref={`/applications/${applicationId}/tasks?bank=${encodeURIComponent(session.bank.slug)}`}
        errorMessage={(error) =>
          error instanceof Error
            ? error.message
            : "The action could not be completed. Please try again."
        }
        reload={async () => {
          const current = await review.refetch({ throwOnError: true });
          if (!current.data) throw new Error("Application unavailable.");
          return current.data;
        }}
        mutate={async (action, input, revision, key) => {
          const queryKey = ["review", session.bank.id, session.user.email, applicationId];
          await client.cancelQueries({ queryKey });
          const updated = await request(
            `/api/v1/banks/${session.bank.id}/applications/${applicationId}/review/${action}`,
            reviewViewSchema,
            {
              method: "POST",
              bankId: session.bank.id,
              actorEmail: session.user.email,
              body: reviewCommand(action, input, revision, key),
            },
          );
          client.setQueryData(queryKey, updated);
          await Promise.all(
            ["applications", "destination", "portal", "tasks", "readiness"].map((name) =>
              client.invalidateQueries({ queryKey: [name, session.bank.id, session.user.email] }),
            ),
          );
          return updated;
        }}
      />
    </div>
  );
}
