import { closingViewSchema } from "@keycade/contracts";
import { ClosingManager } from "@keycade/ui/components/closing-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationClosing({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const queryKey = ["staff-closing", applicationId];
  const base = `/applications/${applicationId}/closing`;
  const closing = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, closingViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3000,
  });
  if (closing.isPending || !closing.isFetchedAfterMount)
    return <Loading>Loading closing details…</Loading>;
  if (
    closing.error &&
    (!closing.data ||
      (closing.error instanceof ApiError && [401, 403, 404].includes(closing.error.status)))
  )
    return <ErrorNotice error={closing.error} onRetry={() => void closing.refetch()} />;
  if (!closing.data) return null;
  const bank = params.get("bank");
  const path = (section: string) =>
    `/applications/${applicationId}/${section}${bank ? `?bank=${encodeURIComponent(bank)}` : ""}`;
  return (
    <div className="space-y-4">
      {closing.error && (
        <ErrorNotice error={closing.error} onRetry={() => void closing.refetch()} />
      )}
      <ClosingManager
        key={applicationId}
        data={closing.data}
        taskHref={(id) => `${path("tasks")}${bank ? "&" : "?"}task=${id}`}
        signatureHref={(id) => `${path("signatures")}${id ? `#envelope-${id}` : ""}`}
        reviewHref={path("review")}
        errorMessage={(error) =>
          error instanceof Error
            ? error.message
            : "The action could not be completed. Please try again."
        }
        reload={async () => {
          const result = await closing.refetch({ throwOnError: true });
          if (!result.data) throw new Error("Closing is unavailable.");
          return result.data;
        }}
        mutate={async (action, input, expectedRevision, idempotencyKey) => {
          await client.cancelQueries({ queryKey });
          const updated = await api.participantRequest(`${base}/${action}`, closingViewSchema, {
            method: "POST",
            body: { expectedRevision, idempotencyKey, ...(input ?? {}) },
          });
          client.setQueryData(queryKey, updated);
          await Promise.all(
            ["staff-workspace", "staff-tasks", "staff-readiness", "staff-review"].map((name) =>
              client.invalidateQueries({ queryKey: [name, applicationId] }),
            ),
          );
          await Promise.all(
            ["staff-queue", "staff-accounts"].map((name) =>
              client.invalidateQueries({ queryKey: [name] }),
            ),
          );
          return updated;
        }}
      />
    </div>
  );
}
