import { activityViewSchema, operationsViewSchema } from "@keycade/contracts";
import { ActivityHistory } from "@keycade/ui/components/activity-history";
import { OperationsWorkspace } from "@keycade/ui/components/operations-workspace";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";
export function StaffActivity({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const query = useInfiniteQuery({
    queryKey: ["staff-activity", applicationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.participantRequest(
        `/applications/${applicationId}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        activityViewSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 30000,
    gcTime: 0,
  });
  if (query.isPending || !query.isFetchedAfterMount) return <Loading>Loading activity…</Loading>;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <ActivityHistory
      entries={query.data.pages.flatMap((page) => page.entries)}
      more={query.hasNextPage}
      busy={query.isFetching}
      loadMore={() => void query.fetchNextPage()}
      refresh={() => void query.refetch()}
    />
  );
}
export function StaffOperations({ applicationId }: { applicationId: string }) {
  const api = useStaffApi(),
    client = useQueryClient();
  const queryKey = ["staff-operations", applicationId];
  const base = `/applications/${applicationId}/operations`;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, operationsViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
    gcTime: 0,
  });
  if (query.isPending || !query.isFetchedAfterMount) return <Loading>Loading operations…</Loading>;
  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <OperationsWorkspace
      data={query.data}
      refreshing={query.isFetching}
      refresh={() => void query.refetch()}
      mutate={async (body) => {
        await client.cancelQueries({ queryKey });
        const updated = await api.participantRequest(`${base}/actions`, operationsViewSchema, {
          method: "POST",
          body,
        });
        client.setQueryData(queryKey, updated);
        await client.invalidateQueries({ queryKey: ["staff-activity", applicationId] });
        return updated;
      }}
    />
  );
}
