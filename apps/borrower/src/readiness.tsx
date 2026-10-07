import { readinessViewSchema } from "@keycade/contracts";
import { ReadinessPanel } from "@keycade/ui/components/checks-manager";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

export function ApplicationReadiness({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const readiness = useQuery({
    queryKey: ["readiness", session.bank.id, session.user.email, applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/readiness`,
        readinessViewSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3000,
  });
  if (readiness.isPending || !readiness.isFetchedAfterMount) return <Loading />;
  if (
    readiness.error &&
    (!readiness.data ||
      (readiness.error instanceof ApiError && [401, 403, 404].includes(readiness.error.status)))
  )
    return <ErrorNotice error={readiness.error} onRetry={() => void readiness.refetch()} />;
  if (!readiness.data) return null;
  return (
    <div className="space-y-3">
      {readiness.error && (
        <ErrorNotice error={readiness.error} onRetry={() => void readiness.refetch()} />
      )}
      <ReadinessPanel data={readiness.data} compact />
    </div>
  );
}
