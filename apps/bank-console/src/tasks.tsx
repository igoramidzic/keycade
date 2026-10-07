import { tasksViewSchema, taskViewSchema } from "@keycade/contracts";
import { TasksManager } from "@keycade/ui/components/tasks-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, useStaffApi } from "./api";
import { useApplicationDocuments } from "./documents";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationTasks({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const documents = useApplicationDocuments({ applicationId });
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
  const base = `/applications/${applicationId}/tasks`;
  const queryKey = ["staff-tasks", applicationId];
  const tasks = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, tasksViewSchema, { signal }),
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
  if (tasks.isPending || !tasks.isFetchedAfterMount || documents.pending)
    return <Loading>Loading tasks…</Loading>;
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
        initialTaskId={new URLSearchParams(window.location.search).get("task")}
        data={tasks.data}
        signatureHref={(envelopeId) =>
          `/applications/${applicationId}/signatures${window.location.search}${envelopeId ? `#envelope-${envelopeId}` : ""}`
        }
        renderDocuments={documents.render}
        errorMessage={(error) =>
          error instanceof ApiError
            ? error.message
            : "We couldn’t connect. Your entries are still here; please try again."
        }
        reload={async () => {
          const updated = await tasks.refetch({ throwOnError: true });
          if (!updated.data) throw new Error("Tasks are unavailable.");
          return updated.data;
        }}
        mutate={(path, body, method) =>
          guarded(async () => {
            await client.cancelQueries({ queryKey });
            if (!path) {
              const updated = await api.participantRequest(base, tasksViewSchema, { method, body });
              client.setQueryData(queryKey, updated);
              await client.invalidateQueries({ queryKey: ["staff-documents", applicationId] });
              await client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] });
              await client.invalidateQueries({ queryKey: ["staff-queue"] });
              return updated;
            }
            if (/\/(identifier|tax-authorization)$/.test(path)) {
              const updated = await api.participantRequest(`${base}${path}`, tasksViewSchema, {
                method,
                body,
              });
              client.setQueryData(queryKey, updated);
              await client.invalidateQueries({ queryKey: ["staff-documents", applicationId] });
              await client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] });
              await client.invalidateQueries({ queryKey: ["staff-queue"] });
              await client.invalidateQueries({ queryKey: ["staff-checks", applicationId] });
              await client.invalidateQueries({ queryKey: ["staff-readiness", applicationId] });
              return updated.tasks.find((task) => path.startsWith(`/${task.id}/`)) ?? updated;
            }
            const updated = await api.participantRequest(`${base}${path}`, taskViewSchema, {
              method,
              body,
            });
            await client.invalidateQueries({ queryKey });
            await client.invalidateQueries({ queryKey: ["staff-documents", applicationId] });
            await client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] });
            await client.invalidateQueries({ queryKey: ["staff-queue"] });
            return updated;
          })
        }
      />
    </div>
  );
}
