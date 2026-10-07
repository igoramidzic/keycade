import { tasksViewSchema, taskViewSchema } from "@keycade/contracts";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { TasksManager } from "@keycade/ui/components/tasks-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, errorMessage, request } from "./api";
import { ApplicationDocuments } from "./documents";
import { ErrorNotice, Loading } from "./workspace-ui";

export function ApplicationTasks({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<unknown>(null);
  async function guarded<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        setAccessError(error);
      throw error;
    }
  }
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/tasks`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const queryKey = ["tasks", session.bank.id, session.user.email, applicationId];
  const tasks = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(base, tasksViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  if (accessError)
    return (
      <ErrorNotice
        error={accessError}
        onRetry={() => {
          void tasks.refetch().then((result) => {
            if (!result.error) setAccessError(null);
          });
        }}
      />
    );
  if (tasks.isPending || !tasks.isFetchedAfterMount) return <Loading />;
  if (
    tasks.error &&
    (!tasks.data ||
      (tasks.error instanceof ApiError && [401, 403, 404].includes(tasks.error.status)))
  )
    return <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />;
  if (!tasks.data) return null;
  return (
    <div className="space-y-5">
      {tasks.error && <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />}
      <TasksManager
        data={tasks.data}
        errorMessage={errorMessage}
        renderDocuments={(taskId, onBusyChange) => (
          <ApplicationDocuments
            session={session}
            applicationId={applicationId}
            taskId={taskId}
            onBusyChange={onBusyChange}
          />
        )}
        reload={() => tasks.refetch()}
        loadTask={(id, signal) =>
          guarded(() => request(`${base}/${id}`, taskViewSchema, { ...options, signal }))
        }
        mutate={(path, body, method) =>
          guarded(async () => {
            await client.cancelQueries({ queryKey });
            if (!path) {
              const updated = await request(base, tasksViewSchema, { ...options, method, body });
              client.setQueryData(queryKey, updated);
              await client.invalidateQueries({
                queryKey: ["portal", session.bank.id, session.user.email, applicationId],
              });
              return updated;
            }
            const updated = await request(`${base}${path}`, taskViewSchema, {
              ...options,
              method,
              body,
            });
            await client.invalidateQueries({ queryKey });
            await client.invalidateQueries({
              queryKey: ["portal", session.bank.id, session.user.email, applicationId],
            });
            await client.invalidateQueries({ queryKey: ["applications"] });
            return updated;
          })
        }
      />
    </div>
  );
}
