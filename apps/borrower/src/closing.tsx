import { closingViewSchema } from "@keycade/contracts";
import { ClosingManager } from "@keycade/ui/components/closing-manager";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useQuery } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

export function ApplicationClosing({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const closing = useQuery({
    queryKey: ["closing", session.bank.id, session.user.email, applicationId],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/banks/${session.bank.id}/applications/${applicationId}/closing`,
        closingViewSchema,
        { signal, bankId: session.bank.id, actorEmail: session.user.email },
      ),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3000,
  });
  if (closing.isPending || !closing.isFetchedAfterMount) return <Loading />;
  if (
    closing.error &&
    (!closing.data ||
      (closing.error instanceof ApiError && [401, 403, 404].includes(closing.error.status)))
  )
    return <ErrorNotice error={closing.error} onRetry={() => void closing.refetch()} />;
  if (!closing.data) return null;
  const path = (section: string) =>
    `/applications/${applicationId}/${section}?bank=${encodeURIComponent(session.bank.slug)}`;
  return (
    <div className="space-y-4">
      {closing.error && (
        <ErrorNotice error={closing.error} onRetry={() => void closing.refetch()} />
      )}
      <ClosingManager
        key={applicationId}
        data={closing.data}
        taskHref={(id) => `${path("tasks")}&task=${id}`}
        signatureHref={(id) => `${path("signatures")}${id ? `#envelope-${id}` : ""}`}
        reviewHref={path("review")}
        errorMessage={(error) =>
          error instanceof Error ? error.message : "Closing is unavailable. Please try again."
        }
        reload={async () => {
          const result = await closing.refetch({ throwOnError: true });
          if (!result.data) throw new Error("Closing is unavailable.");
          return result.data;
        }}
        mutate={async () => {
          throw new Error("Only bank staff can start closing or record simulated funding.");
        }}
      />
    </div>
  );
}
