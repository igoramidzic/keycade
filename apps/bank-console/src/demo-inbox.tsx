import { demoInboxMessageSchema, demoInboxViewSchema } from "@keycade/contracts";
import { DemoInbox } from "@keycade/ui/components/demo-inbox";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function StaffDemoInbox() {
  const api = useStaffApi();
  const inbox = useQuery({
    queryKey: ["demo-inbox", api.bankBase],
    queryFn: ({ signal }) => api.participantRequest("/demo-inbox", demoInboxViewSchema, { signal }),
    refetchInterval: 5000,
    retry: false,
    gcTime: 0,
  });
  return (
    <div className="space-y-5">
      <Link to="/" className="text-sm underline underline-offset-4">
        Back to applications
      </Link>
      {inbox.isPending ? (
        <Loading>Loading demo inbox…</Loading>
      ) : inbox.error ? (
        <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : (
        <DemoInbox
          messages={inbox.data.messages}
          refreshing={inbox.isFetching}
          refresh={() => void inbox.refetch()}
          open={(id, signal) =>
            api.participantRequest(`/demo-inbox/${id}`, demoInboxMessageSchema, { signal })
          }
        />
      )}
    </div>
  );
}
