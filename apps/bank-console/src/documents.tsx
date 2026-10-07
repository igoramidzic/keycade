import {
  documentActionResultSchema,
  documentsViewSchema,
  documentUploadResultSchema,
} from "@keycade/contracts";
import { DocumentsManager } from "@keycade/ui/components/documents-manager";
import { createDocumentTransfer } from "@keycade/ui/lib/document-transfer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationDocuments({
  applicationId,
  taskId,
  onBusyChange,
}: {
  applicationId: string;
  taskId?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const api = useStaffApi();
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<unknown>(null);
  const base = `/applications/${applicationId}/documents`;
  const queryKey = ["staff-documents", applicationId];
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
    queryFn: ({ signal }) => api.participantRequest(base, documentsViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3_000,
  });
  const transfer = createDocumentTransfer({
    base: `${api.bankBase}${base}`,
    verify: api.verify,
    error: (code, status, message) => new ApiError(code, status, message),
  });
  async function reload() {
    await documents.refetch();
    await Promise.all([
      client.invalidateQueries({ queryKey: ["staff-tasks", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-queue"] }),
    ]);
  }
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
  if (documents.isPending || !documents.isFetchedAfterMount)
    return <Loading>Loading documents…</Loading>;
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
        errorMessage={(error) =>
          error instanceof ApiError ? error.message : "We couldn’t connect. Please try again."
        }
        reload={reload}
        begin={(files) =>
          guarded(() =>
            api.participantRequest(`${base}/uploads`, documentUploadResultSchema, {
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
            api.participantRequest(`${base}/uploads/${id}`, documentActionResultSchema, {
              method: "DELETE",
            }),
          )
        }
        download={(id, fileName) => guarded(() => transfer.download(id, fileName))}
        retryScan={(id) =>
          guarded(() =>
            api.participantRequest(
              `${base}/versions/${id}/retry-scan`,
              documentActionResultSchema,
              {
                method: "POST",
                body: {},
              },
            ),
          )
        }
      />
    </div>
  );
}
