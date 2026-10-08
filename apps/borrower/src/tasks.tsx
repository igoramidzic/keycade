import { tasksViewSchema, taskViewSchema } from "@keycade/contracts";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { TasksManager } from "@keycade/ui/components/tasks-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, errorMessage, request } from "./api";
import { useApplicationDocuments } from "./documents";
import { ErrorNotice, Loading } from "./workspace-ui";

export function ApplicationTasks({
  session,
  applicationId,
  businessName,
  active = true,
}: {
  session: AuthenticatedSession;
  applicationId: string;
  businessName: string;
  active?: boolean;
}) {
  const client = useQueryClient();
  const documents = useApplicationDocuments({ session, applicationId, active });
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
    enabled: active,
    queryFn: ({ signal }) => request(base, tasksViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: active ? 15_000 : false,
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
  if (tasks.isPending || !tasks.isFetchedAfterMount || documents.pending) return <Loading />;
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
        borrowerBusinessName={businessName}
        initialTaskId={new URLSearchParams(window.location.search).get("task")}
        data={tasks.data}
        signatureHref={(envelopeId) =>
          `/applications/${applicationId}/signatures?bank=${encodeURIComponent(session.bank.slug)}${envelopeId ? `#envelope-${envelopeId}` : ""}`
        }
        errorMessage={errorMessage}
        renderDocuments={documents.render}
        reload={async () => {
          const updated = await tasks.refetch({ throwOnError: true });
          if (!updated.data) throw new Error("Tasks are unavailable.");
          return updated.data;
        }}
        mutate={(path, body, method) =>
          guarded(async () => {
            await client.cancelQueries({ queryKey });
            if (!path) {
              const updated = await request(base, tasksViewSchema, { ...options, method, body });
              client.setQueryData(queryKey, updated);
              await client.invalidateQueries({
                queryKey: ["documents", session.bank.id, session.user.email, applicationId],
              });
              await client.invalidateQueries({
                queryKey: ["portal", session.bank.id, session.user.email, applicationId],
              });
              return updated;
            }
            if (/\/(identifier|tax-authorization)$/.test(path)) {
              const updated = await request(`${base}${path}`, tasksViewSchema, {
                ...options,
                method,
                body,
              });
              client.setQueryData(queryKey, updated);
              await client.invalidateQueries({
                queryKey: ["documents", session.bank.id, session.user.email, applicationId],
              });
              await client.invalidateQueries({
                queryKey: ["portal", session.bank.id, session.user.email, applicationId],
              });
              await client.invalidateQueries({ queryKey: ["applications"] });
              await client.invalidateQueries({
                queryKey: ["readiness", session.bank.id, session.user.email, applicationId],
              });
              return updated.tasks.find((task) => path.startsWith(`/${task.id}/`)) ?? updated;
            }
            const updated = await request(`${base}${path}`, taskViewSchema, {
              ...options,
              method,
              body,
            });
            await client.invalidateQueries({ queryKey });
            await client.invalidateQueries({
              queryKey: ["documents", session.bank.id, session.user.email, applicationId],
            });
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
