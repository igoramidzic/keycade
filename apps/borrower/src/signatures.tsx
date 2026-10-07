import { authSessionSchema, signatureLookupSchema, signaturesViewSchema } from "@keycade/contracts";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { SignaturesManager } from "@keycade/ui/components/signatures-manager";
import { downloadSignatureArtifact } from "@keycade/ui/lib/signature-download";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import { ApiError, errorMessage, request } from "./api";
import { ErrorNotice, Loading } from "./workspace-ui";

export function SignatureContinuation({ session }: { session: AuthenticatedSession }) {
  const { envelopeId } = useParams();
  const lookup = useQuery({
    queryKey: ["signature-continuation", session.bank.id, session.user.email, envelopeId],
    queryFn: ({ signal }) =>
      request(`/api/v1/banks/${session.bank.id}/signatures/${envelopeId}`, signatureLookupSchema, {
        signal,
        bankId: session.bank.id,
        actorEmail: session.user.email,
      }),
    retry: false,
    refetchOnMount: "always",
  });
  if (lookup.isPending || !lookup.isFetchedAfterMount) return <Loading />;
  if (lookup.error)
    return <ErrorNotice error={lookup.error} onRetry={() => void lookup.refetch()} />;
  if (!lookup.data) return null;
  return (
    <Navigate
      replace
      to={`/applications/${lookup.data.applicationId}/signatures?bank=${encodeURIComponent(session.bank.slug)}#envelope-${envelopeId}`}
    />
  );
}

export function ApplicationSignatures({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const client = useQueryClient();
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/signatures`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const queryKey = ["signatures", session.bank.id, session.user.email, applicationId];
  const signatures = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(base, signaturesViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 3000,
  });
  async function reload() {
    await signatures.refetch();
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["tasks", session.bank.id, session.user.email, applicationId],
      }),
      client.invalidateQueries({
        queryKey: ["portal", session.bank.id, session.user.email, applicationId],
      }),
      client.invalidateQueries({
        queryKey: ["readiness", session.bank.id, session.user.email, applicationId],
      }),
    ]);
  }
  async function verify(signal: AbortSignal) {
    const current = await request("/api/v1/auth/session", authSessionSchema, { signal });
    if (
      !current.authenticated ||
      current.bank.id !== session.bank.id ||
      current.user.email !== session.user.email
    )
      throw new ApiError("SESSION_CHANGED", 401, "Your sign-in changed. Please sign in again.");
  }
  if (signatures.isPending || !signatures.isFetchedAfterMount) return <Loading />;
  if (
    signatures.error &&
    (!signatures.data ||
      (signatures.error instanceof ApiError && [401, 403, 404].includes(signatures.error.status)))
  )
    return <ErrorNotice error={signatures.error} onRetry={() => void signatures.refetch()} />;
  if (!signatures.data) return null;
  return (
    <div className="space-y-4">
      {signatures.error && (
        <ErrorNotice error={signatures.error} onRetry={() => void signatures.refetch()} />
      )}
      <SignaturesManager
        data={signatures.data}
        downloadSource={(versionId, fileName) =>
          downloadSignatureArtifact({
            url: `/api/v1/banks/${session.bank.id}/applications/${applicationId}/documents/versions/${versionId}/content`,
            envelopeId: versionId,
            fileName,
            verify,
          })
        }
        errorMessage={errorMessage}
        act={async (id, action) => {
          const suffix = action === "sign" || action === "decline" ? "act" : action;
          await request(`${base}/${id}/${suffix}`, signaturesViewSchema, {
            ...options,
            method: "POST",
            body: suffix === "act" ? { action } : {},
          });
          await reload();
        }}
        download={(id) =>
          downloadSignatureArtifact({
            url: `${base}/${id}/artifact`,
            envelopeId: id,
            verify,
          })
        }
      />
    </div>
  );
}
