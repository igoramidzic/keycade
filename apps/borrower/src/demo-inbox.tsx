import { demoInboxMessageSchema, demoInboxViewSchema } from "@keycade/contracts";
import { DemoInbox } from "@keycade/ui/components/demo-inbox";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

export function BorrowerDemoInbox({ session }: { session: AuthenticatedSession }) {
  const base = `/api/v1/banks/${session.bank.id}/demo-inbox`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const inbox = useQuery({
    queryKey: ["demo-inbox", session.bank.id, session.user.email],
    queryFn: ({ signal }) => request(base, demoInboxViewSchema, { ...options, signal }),
    refetchInterval: 5000,
    retry: false,
    gcTime: 0,
  });
  return (
    <div className="space-y-5">
      <Link
        to={`/?bank=${encodeURIComponent(session.bank.slug)}`}
        className="text-sm underline underline-offset-4"
      >
        Your applications
      </Link>
      {inbox.isPending ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : (
        <DemoInbox
          messages={inbox.data.messages}
          refreshing={inbox.isFetching}
          refresh={() => void inbox.refetch()}
          open={(id, signal) =>
            request(`${base}/${id}`, demoInboxMessageSchema, { ...options, signal })
          }
        />
      )}
    </div>
  );
}
