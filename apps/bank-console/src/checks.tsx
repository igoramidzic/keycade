import { checksViewSchema, readinessViewSchema } from "@keycade/contracts";
import { ChecksManager, ReadinessPanel } from "@keycade/ui/components/checks-manager";
import { checkRefreshInterval, readinessRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationChecks({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const base = `/applications/${applicationId}`;
  const queryKey = ["staff-checks", applicationId];
  const checks = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(`${base}/checks`, checksViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : checkRefreshInterval(query.state.data),
  });
  const readiness = useQuery({
    queryKey: ["staff-readiness", applicationId],
    queryFn: ({ signal }) =>
      api.participantRequest(`${base}/readiness`, readinessViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : readinessRefreshInterval(query.state.data),
  });
  async function mutate(checkId: string, action: string, body: object) {
    const updated = await api.participantRequest(
      `${base}/checks/${checkId}/${action}`,
      checksViewSchema,
      { method: "POST", body },
    );
    client.setQueryData(queryKey, updated);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["staff-readiness", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-tasks", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] }),
    ]);
  }
  const error = checks.error ?? readiness.error;
  if (
    checks.isPending ||
    readiness.isPending ||
    !checks.isFetchedAfterMount ||
    !readiness.isFetchedAfterMount
  )
    return <Loading>Loading checks and readiness…</Loading>;
  if (
    error &&
    (!checks.data ||
      !readiness.data ||
      (error instanceof ApiError && [401, 403, 404].includes(error.status)))
  )
    return (
      <ErrorNotice
        error={error}
        onRetry={() => {
          void checks.refetch();
          void readiness.refetch();
        }}
      />
    );
  if (!checks.data || !readiness.data) return null;
  return (
    <div className="space-y-5">
      {error && (
        <ErrorNotice
          error={error}
          onRetry={() => {
            void checks.refetch();
            void readiness.refetch();
          }}
        />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ChecksManager
          data={checks.data}
          errorMessage={(error) =>
            error instanceof Error
              ? error.message
              : "The action could not be completed. Please try again."
          }
          retry={(checkId, runId, reason) => mutate(checkId, "retry", { runId, reason })}
          resolve={(checkId, runId) =>
            mutate(checkId, "resolve", { runId, reason: "reviewed_synthetic_evidence" })
          }
        />
        <ReadinessPanel data={readiness.data} />
      </div>
    </div>
  );
}
