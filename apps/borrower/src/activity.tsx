import { activityViewSchema } from "@keycade/contracts";
import { ActivityHistory } from "@keycade/ui/components/activity-history";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useInfiniteQuery } from "@tanstack/react-query";
import { request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";
export function ApplicationActivity({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["activity", session.bank.id, session.user.email, applicationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        activityViewSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 30000,
    gcTime: 0,
  });
  if (query.isPending || !query.isFetchedAfterMount) return <Loading />;
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
