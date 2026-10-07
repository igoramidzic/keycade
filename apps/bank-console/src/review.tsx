import { reviewReasonLabels, reviewViewSchema } from "@keycade/contracts";
import { buttonVariants } from "@keycade/ui/components/button";
import { ReviewManager } from "@keycade/ui/components/review-manager";
import { reviewCommand, reviewReasons } from "@keycade/ui/lib/review-actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationReview({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const location = useLocation();
  const queryKey = ["staff-review", applicationId];
  const base = `/applications/${applicationId}/review`;
  const review = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, reviewViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });
  if (review.isPending || !review.isFetchedAfterMount)
    return <Loading>Loading application review…</Loading>;
  if (
    review.error &&
    (!review.data ||
      (review.error instanceof ApiError && [401, 403, 404].includes(review.error.status)))
  )
    return <ErrorNotice error={review.error} onRetry={() => void review.refetch()} />;
  if (!review.data) return null;
  return (
    <div className="space-y-4">
      {review.error && <ErrorNotice error={review.error} onRetry={() => void review.refetch()} />}
      {["approved", "closing", "funded"].includes(review.data.status) && (
        <a
          className={buttonVariants({ variant: "outline" })}
          href={`/applications/${applicationId}/closing${location.search}`}
        >
          {review.data.status === "funded" ? "View funded account" : "View closing requirements"}
        </a>
      )}
      <ReviewManager
        data={review.data}
        reasons={reviewReasons(reviewReasonLabels)}
        taskHref={`/applications/${applicationId}/tasks${location.search}`}
        checkHref={`/applications/${applicationId}/checks${location.search}`}
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
          await client.cancelQueries({ queryKey });
          const updated = await api.participantRequest(`${base}/${action}`, reviewViewSchema, {
            method: "POST",
            body: reviewCommand(action, input, revision, key),
          });
          client.setQueryData(queryKey, updated);
          await Promise.all(
            ["staff-workspace", "staff-tasks", "staff-readiness", "staff-checks"].map((name) =>
              client.invalidateQueries({ queryKey: [name, applicationId] }),
            ),
          );
          await client.invalidateQueries({ queryKey: ["staff-queue"] });
          return updated;
        }}
      />
    </div>
  );
}
