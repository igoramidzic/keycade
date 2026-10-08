import { participantsWorkspaceSchema, tasksViewSchema } from "@keycade/contracts";
import { ParticipantsManager } from "@keycade/ui/components/participants-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationParticipants({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const base = `/applications/${applicationId}/participants`;
  const queryKey = ["staff-participants", applicationId];
  const people = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, participantsWorkspaceSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const tasks = useQuery({
    queryKey: ["staff-tasks", applicationId],
    queryFn: ({ signal }) =>
      api.participantRequest(`/applications/${applicationId}/tasks`, tasksViewSchema, { signal }),
    enabled: Boolean(people.data?.canInvite),
    retry: false,
    refetchOnMount: "always",
  });
  if (people.isPending || !people.isFetchedAfterMount)
    return <Loading>Loading participants…</Loading>;
  if (people.error)
    return <ErrorNotice error={people.error} onRetry={() => void people.refetch()} />;
  if (!people.data) return null;
  if (people.data.canInvite && tasks.isPending)
    return <Loading>Loading tasks for invitations…</Loading>;
  if (people.data.canInvite && tasks.error)
    return <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />;
  return (
    <ParticipantsManager
      data={people.data}
      availableTasks={
        tasks.data?.tasks
          .filter(
            (task) =>
              task.visibility !== "private" &&
              !["completed", "waived", "cancelled"].includes(task.state) &&
              task.inputKind !== "signature",
          )
          .map((task) => ({
            ...task,
            assigneeName:
              tasks.data?.assignees.find((person) => person.id === task.assigneeParticipantId)
                ?.displayName ?? null,
          })) ?? []
      }
      errorMessage={(error) =>
        error instanceof ApiError
          ? error.message
          : "We couldn’t connect. Your entries are still here; please try again."
      }
      mutate={async (path, body) => {
        await client.cancelQueries({ queryKey });
        const updated = await api.participantRequest(
          `${base}${path}`,
          participantsWorkspaceSchema,
          {
            method: "POST",
            body,
          },
        );
        client.setQueryData(queryKey, updated);
        await client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] });
        await client.invalidateQueries({ queryKey: ["staff-tasks", applicationId] });
      }}
    />
  );
}
