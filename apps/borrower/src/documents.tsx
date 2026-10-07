import {
  authSessionSchema,
  documentActionResultSchema,
  documentsViewSchema,
  documentUploadResultSchema,
} from "@keycade/contracts";
import { DocumentsManager } from "@keycade/ui/components/documents-manager";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { createDocumentTransfer } from "@keycade/ui/lib/document-transfer";
import { documentRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, errorMessage, request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

type DocumentsProps = {
  session: AuthenticatedSession;
  applicationId: string;
  taskId?: string;
  onBusyChange?: (busy: boolean) => void;
};
export function ApplicationDocuments(props: DocumentsProps) {
  const workspace = useApplicationDocuments(props);
  return workspace.render(props.taskId, props.onBusyChange);
}

export function useApplicationDocuments({
  session,
  applicationId,
}: Pick<DocumentsProps, "session" | "applicationId">) {
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<unknown>(null);
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/documents`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const queryKey = ["documents", session.bank.id, session.user.email, applicationId];
  async function guarded<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        setAccessError(error);
      throw error;
    }
  }
  const documents = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(base, documentsViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : documentRefreshInterval(query.state.data),
  });
  const transfer = createDocumentTransfer({
    base,
    verify: async (signal) => {
      const current = await request("/api/v1/auth/session", authSessionSchema, { signal });
      if (
        !current.authenticated ||
        current.bank.id !== session.bank.id ||
        current.user.email !== session.user.email
      )
        throw new ApiError("SESSION_CHANGED", 401, "Your sign-in changed. Please sign in again.");
      return current;
    },
    error: (code, status, message) => new ApiError(code, status, message),
  });
  async function reload() {
    await documents.refetch();
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["tasks", session.bank.id, session.user.email, applicationId],
      }),
      client.invalidateQueries({
        queryKey: ["portal", session.bank.id, session.user.email, applicationId],
      }),
      client.invalidateQueries({ queryKey: ["applications"] }),
    ]);
  }
  function render(taskId?: string, onBusyChange?: (busy: boolean) => void) {
    if (accessError)
      return (
        <ErrorNotice
          error={accessError}
          onRetry={() => {
            void documents.refetch().then((result) => {
              if (!result.error) setAccessError(null);
            });
          }}
        />
      );
    if (documents.isPending || !documents.isFetchedAfterMount) return <Loading />;
    if (
      documents.error &&
      (!documents.data ||
        (documents.error instanceof ApiError && [401, 403, 404].includes(documents.error.status)))
    )
      return <ErrorNotice error={documents.error} onRetry={() => void documents.refetch()} />;
    if (!documents.data) return null;
    return (
      <div className="space-y-4">
        {documents.error && (
          <ErrorNotice error={documents.error} onRetry={() => void documents.refetch()} />
        )}
        <DocumentsManager
          data={documents.data}
          taskId={taskId}
          onBusyChange={onBusyChange}
          errorMessage={errorMessage}
          reload={reload}
          begin={(files) =>
            guarded(() =>
              request(`${base}/uploads`, documentUploadResultSchema, {
                ...options,
                method: "POST",
                body: { files },
              }),
            )
          }
          upload={(id, file, progress, signal) =>
            guarded(() => transfer.upload(id, file, progress, signal))
          }
          cancel={(id) =>
            guarded(() =>
              request(`${base}/uploads/${id}`, documentActionResultSchema, {
                ...options,
                method: "DELETE",
              }),
            )
          }
          download={(id, fileName) => guarded(() => transfer.download(id, fileName))}
          retryScan={(id) =>
            guarded(() =>
              request(`${base}/versions/${id}/retry-scan`, documentActionResultSchema, {
                ...options,
                method: "POST",
                body: {},
              }),
            )
          }
          retryProcessing={(id) =>
            guarded(() =>
              request(`${base}/versions/${id}/retry-processing`, documentActionResultSchema, {
                ...options,
                method: "POST",
                body: {},
              }),
            )
          }
          correctCategory={(id, versionId, category, reason) =>
            guarded(() =>
              request(`${base}/${id}/category`, documentActionResultSchema, {
                ...options,
                method: "POST",
                body: { versionId, category, reason },
              }),
            )
          }
        />
      </div>
    );
  }
  return { pending: documents.isPending || !documents.isFetchedAfterMount, render };
}
