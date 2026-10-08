import {
  documentActionResultSchema,
  documentsViewSchema,
  documentUploadResultSchema,
  financialFactsViewSchema,
} from "@keycade/contracts";
import { DocumentWorkspace } from "@keycade/ui/components/document-workspace";
import { DocumentsManager } from "@keycade/ui/components/documents-manager";
import { createDocumentTransfer } from "@keycade/ui/lib/document-transfer";
import { documentRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

type DocumentsProps = {
  applicationId: string;
  taskId?: string;
  onBusyChange?: (busy: boolean) => void;
};
export function ApplicationDocuments(props: DocumentsProps) {
  const workspace = useApplicationDocuments(props);
  return workspace.render(props.taskId, props.onBusyChange);
}

export function useApplicationDocuments({ applicationId }: Pick<DocumentsProps, "applicationId">) {
  const api = useStaffApi();
  const client = useQueryClient();
  const [accessError, setAccessError] = useState<unknown>(null);
  const [selected, setSelected] = useState<{
    documentId: string;
    versionId: string;
    originTaskId: string | null;
  } | null>(null);
  const base = `/applications/${applicationId}/documents`;
  const financialBase = `/applications/${applicationId}/financial-facts`;
  const queryKey = ["staff-documents", applicationId];
  async function guarded<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        setAccessError(error);
        setSelected(null);
      }
      throw error;
    }
  }
  const documents = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.participantRequest(base, documentsViewSchema, { signal }),
    enabled: !accessError,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error ? false : selected ? 3_000 : documentRefreshInterval(query.state.data),
  });
  const facts = useQuery({
    queryKey: ["staff-financial-facts", applicationId],
    queryFn: ({ signal }) =>
      guarded(() => api.participantRequest(financialBase, financialFactsViewSchema, { signal })),
    enabled: selected !== null && !accessError,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.error ? false : 3_000),
  });
  useEffect(() => {
    if (documents.error instanceof ApiError && [401, 403, 404].includes(documents.error.status)) {
      setAccessError(documents.error);
      setSelected(null);
    }
  }, [documents.error]);
  useEffect(() => {
    if (!accessError) return;
    for (const prefix of ["staff-documents", "staff-financial-facts"]) {
      void client.cancelQueries({ queryKey: [prefix, applicationId] });
      client.removeQueries({ queryKey: [prefix, applicationId] });
    }
  }, [accessError, applicationId, client]);
  useEffect(() => {
    if (
      selected &&
      documents.data &&
      !documents.data.documents.some(
        (document) =>
          document.id === selected.documentId &&
          document.versions.some((version) => version.id === selected.versionId),
      )
    ) {
      setSelected(null);
      setAccessError(
        new ApiError(
          "DOCUMENT_UNAVAILABLE",
          404,
          "This document is no longer available to your staff account.",
        ),
      );
    }
  }, [documents.data, selected]);
  const transfer = createDocumentTransfer({
    base: `${api.bankBase}${base}`,
    verify: api.verify,
    error: (code, status, message) => new ApiError(code, status, message),
  });
  async function reload() {
    await documents.refetch();
    if (selected) await facts.refetch();
    await Promise.all([
      client.invalidateQueries({ queryKey: ["staff-tasks", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-queue"] }),
    ]);
  }
  const errorMessage = (error: unknown) =>
    error instanceof ApiError ? error.message : "We couldn’t connect. Please try again.";
  function render(
    taskId?: string,
    onBusyChange?: (busy: boolean) => void,
    taskVisibility?: "shared" | "assigned" | "private",
  ) {
    if (accessError)
      return (
        <ErrorNotice
          error={accessError}
          onRetry={() => {
            void api.participantRequest(base, documentsViewSchema).then((result) => {
              client.setQueryData(queryKey, result);
              setAccessError(null);
            }, setAccessError);
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
          key={taskId ?? "application"}
          data={documents.data}
          taskId={taskId}
          taskVisibility={taskVisibility}
          onBusyChange={onBusyChange}
          onOpenDocument={(documentId, versionId) =>
            setSelected({ documentId, versionId, originTaskId: taskId ?? null })
          }
          errorMessage={errorMessage}
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
          retryProcessing={(id) =>
            guarded(() =>
              api.participantRequest(
                `${base}/versions/${id}/retry-processing`,
                documentActionResultSchema,
                { method: "POST", body: {} },
              ),
            )
          }
          correctCategory={(id, versionId, category, reason, expectedRevision) =>
            guarded(() =>
              api.participantRequest(`${base}/${id}/category`, documentActionResultSchema, {
                method: "POST",
                body: {
                  versionId,
                  category,
                  reason,
                  expectedRevision,
                },
              }),
            )
          }
        />
        {selected &&
          selected.originTaskId === (taskId ?? null) &&
          documents.data.documents
            .filter((document) => document.id === selected.documentId)
            .map((document) => (
              <DocumentWorkspace
                key={document.id}
                document={document}
                initialVersionId={selected.versionId}
                facts={facts.data ?? null}
                factsError={facts.error ? errorMessage(facts.error) : null}
                preview={(id, signal) => guarded(() => transfer.preview(id, signal))}
                download={(id, fileName) => guarded(() => transfer.download(id, fileName))}
                retryScan={(id) =>
                  guarded(() =>
                    api.participantRequest(
                      `${base}/versions/${id}/retry-scan`,
                      documentActionResultSchema,
                      { method: "POST", body: {} },
                    ),
                  )
                }
                retryProcessing={(id) =>
                  guarded(() =>
                    api.participantRequest(
                      `${base}/versions/${id}/retry-processing`,
                      documentActionResultSchema,
                      { method: "POST", body: {} },
                    ),
                  )
                }
                updateMetadata={(input) =>
                  guarded(() =>
                    api.participantRequest(
                      `${base}/${document.id}/metadata`,
                      documentActionResultSchema,
                      { method: "POST", body: input },
                    ),
                  )
                }
                correctCategory={(versionId, category, reason, expectedRevision) =>
                  guarded(() =>
                    api.participantRequest(
                      `${base}/${document.id}/category`,
                      documentActionResultSchema,
                      {
                        method: "POST",
                        body: {
                          versionId,
                          category,
                          reason,
                          expectedRevision,
                        },
                      },
                    ),
                  )
                }
                review={(input) =>
                  guarded(() =>
                    api.participantRequest(financialBase, financialFactsViewSchema, {
                      method: "POST",
                      body: input,
                    }),
                  )
                }
                reload={reload}
                close={() => setSelected(null)}
                errorMessage={errorMessage}
              />
            ))}
      </div>
    );
  }
  return { pending: documents.isPending || !documents.isFetchedAfterMount, render };
}
