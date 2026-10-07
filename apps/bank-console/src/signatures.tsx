import {
  documentsViewSchema,
  participantsWorkspaceSchema,
  signaturesViewSchema,
  tasksViewSchema,
} from "@keycade/contracts";
import { SignaturesManager } from "@keycade/ui/components/signatures-manager";
import { downloadSignatureArtifact } from "@keycade/ui/lib/signature-download";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, useStaffApi } from "./api";
import { ErrorNotice, Loading } from "./ui";

export function ApplicationSignatures({ applicationId }: { applicationId: string }) {
  const api = useStaffApi();
  const client = useQueryClient();
  const base = `/applications/${applicationId}`;
  const signatures = useQuery({
    queryKey: ["staff-signatures", applicationId],
    queryFn: ({ signal }) =>
      api.participantRequest(`${base}/signatures`, signaturesViewSchema, { signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3000,
  });
  const choices = useQuery({
    queryKey: ["staff-signature-choices", applicationId],
    queryFn: async ({ signal }) => {
      const [tasks, documents, participants] = await Promise.all([
        api.participantRequest(`${base}/tasks`, tasksViewSchema, { signal }),
        api.participantRequest(`${base}/documents`, documentsViewSchema, { signal }),
        api.participantRequest(`${base}/participants`, participantsWorkspaceSchema, { signal }),
      ]);
      return {
        tasks: tasks.tasks.filter(
          (task) => task.state !== "cancelled" && ["answer", "signature"].includes(task.inputKind),
        ),
        sources: documents.documents.flatMap((document) =>
          document.versions
            .filter(
              (version) =>
                version.id === document.currentVersionId &&
                version.uploadState === "uploaded" &&
                version.scanState === "clean",
            )
            .map((version) => ({ id: version.id, fileName: version.fileName })),
        ),
        signers: participants.participants.filter((participant) => participant.status === "active"),
      };
    },
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  async function mutate(path: string, body: object) {
    const updated = await api.participantRequest(
      `${base}/signatures${path}`,
      signaturesViewSchema,
      { method: "POST", body },
    );
    client.setQueryData(["staff-signatures", applicationId], updated);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["staff-tasks", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-readiness", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-signature-choices", applicationId] }),
      client.invalidateQueries({ queryKey: ["staff-workspace", applicationId] }),
    ]);
  }
  const error = signatures.error ?? choices.error;
  if (
    signatures.isPending ||
    choices.isPending ||
    !signatures.isFetchedAfterMount ||
    !choices.isFetchedAfterMount
  )
    return <Loading>Loading signature requests…</Loading>;
  if (
    error &&
    (!signatures.data ||
      !choices.data ||
      (error instanceof ApiError && [401, 403, 404].includes(error.status)))
  )
    return (
      <ErrorNotice
        error={error}
        onRetry={() => {
          void signatures.refetch();
          void choices.refetch();
        }}
      />
    );
  if (!signatures.data || !choices.data) return null;
  return (
    <div className="space-y-4">
      {error && (
        <ErrorNotice
          error={error}
          onRetry={() => {
            void signatures.refetch();
            void choices.refetch();
          }}
        />
      )}
      <SignaturesManager
        data={signatures.data}
        downloadSource={(versionId, fileName) =>
          downloadSignatureArtifact({
            url: `${api.bankBase}${base}/documents/versions/${versionId}/content`,
            envelopeId: versionId,
            fileName,
            verify: api.verify,
          })
        }
        choices={choices.data}
        errorMessage={(error) =>
          error instanceof Error
            ? error.message
            : "The action could not be completed. Please try again."
        }
        create={(body) => mutate("", body)}
        act={(id, action) =>
          mutate(
            `/${id}/${action === "sign" || action === "decline" ? "act" : action}`,
            action === "sign" || action === "decline" ? { action } : {},
          )
        }
        download={(id) =>
          downloadSignatureArtifact({
            url: `${api.bankBase}${base}/signatures/${id}/artifact`,
            envelopeId: id,
            verify: api.verify,
          })
        }
      />
    </div>
  );
}
