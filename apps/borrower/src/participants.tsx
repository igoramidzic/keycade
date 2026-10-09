import {
  acceptInvitationResponseSchema,
  invitationViewSchema,
  participantsWorkspaceSchema,
} from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button, buttonVariants } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import {
  ParticipantsManager,
  participantRoleLabels,
  participantScopeLabel,
} from "@keycade/ui/components/participants-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ApiError, errorMessage, request } from "./api";
import { applicationPath, ErrorNotice, Loading } from "./workspace-ui";

export function ApplicationPeople({
  session,
  applicationId,
}: {
  session: AuthenticatedSession;
  applicationId: string;
}) {
  const client = useQueryClient();
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/participants`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const queryKey = ["participants", session.bank.id, session.user.email, applicationId];
  const people = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(base, participantsWorkspaceSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  if (people.isPending || !people.isFetchedAfterMount) return <Loading />;
  if (people.error)
    return <ErrorNotice error={people.error} onRetry={() => void people.refetch()} />;
  if (!people.data) return null;
  return (
    <ParticipantsManager
      data={{ ...people.data, canInvite: false }}
      errorMessage={errorMessage}
      mutate={async (path, body) => {
        await client.cancelQueries({ queryKey });
        const updated = await request(`${base}${path}`, participantsWorkspaceSchema, {
          ...options,
          method: "POST",
          body,
        });
        client.setQueryData(queryKey, updated);
        await client.invalidateQueries({
          queryKey: ["tasks", session.bank.id, session.user.email, applicationId],
        });
      }}
    />
  );
}

export function InvitationAcceptance({ session }: { session: AuthenticatedSession }) {
  const { invitationId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const base = `/api/v1/banks/${session.bank.id}/invitations/${invitationId}`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const invitation = useQuery({
    queryKey: ["invitation", session.bank.id, session.user.email, invitationId],
    queryFn: ({ signal }) => request(base, invitationViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const home = `/?bank=${encodeURIComponent(session.bank.slug)}`;
  // Keep copied invitation URLs usable after sign-out. Only the authenticated bank is authoritative.
  if (new URLSearchParams(location.search).get("bank") !== session.bank.slug)
    return (
      <Navigate
        replace
        to={`/invitations/${invitationId}?bank=${encodeURIComponent(session.bank.slug)}`}
      />
    );
  if (invitation.isPending || !invitation.isFetchedAfterMount) return <Loading />;
  if (invitation.error)
    return (
      <div className="space-y-4">
        <Alert variant="destructive" role="alert">
          <AlertTitle>This invitation is unavailable</AlertTitle>
          <AlertDescription>
            {invitation.error instanceof ApiError && [403, 404].includes(invitation.error.status)
              ? "Sign in with the email address that received this invitation. A different account cannot accept it."
              : errorMessage(invitation.error)}
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => void invitation.refetch()}>
          Try again
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} to={home}>
          Your applications
        </Link>
      </div>
    );
  const data = invitation.data;
  if (!data) return null;
  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const result = await request(`${base}/accept`, acceptInvitationResponseSchema, {
        ...options,
        method: "POST",
        body: {},
      });
      await client.invalidateQueries({ queryKey: ["applications"] });
      navigate(applicationPath(result.applicationId, session.bank.slug), { replace: true });
    } catch (failure) {
      setError(failure);
      void invitation.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl">Application invitation</h1>
        </CardTitle>
        <CardDescription>
          {data.bankName} · {data.businessName ?? "Business application"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-6">
          Review your role and access before accepting this invitation.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{participantRoleLabels[data.role]}</Badge>
          <Badge variant="outline">{participantScopeLabel(data.scope)}</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {data.scope === "assigned"
            ? "Your access is limited to this application’s summary and your explicitly assigned tasks and permitted documents."
            : "Your access applies to this application. Other people’s private identity information remains restricted."}
        </p>
        <p className="text-sm text-muted-foreground">
          Expires {new Date(data.expiresAt).toLocaleString()}
        </p>
        {session.authenticationMethod === "demo" && (
          <Alert>
            <AlertTitle>Verify your email to accept</AlertTitle>
            <AlertDescription>
              Demo sign-in does not verify an email address. Open your invitation email in the local
              inbox and confirm the sign-in link, then return here to accept.
            </AlertDescription>
          </Alert>
        )}
        {data.status === "accepted" ? (
          <>
            <p role="status" className="text-sm">
              This invitation has already been accepted.
            </p>
            <Link
              className={buttonVariants()}
              to={applicationPath(data.applicationId, session.bank.slug)}
            >
              Open application
            </Link>
          </>
        ) : data.status === "expired" || data.status === "revoked" ? (
          <Alert variant="destructive">
            <AlertTitle>Invitation {data.status}</AlertTitle>
            <AlertDescription>Ask the lender for a new invitation.</AlertDescription>
          </Alert>
        ) : !data.canAccept && session.authenticationMethod !== "demo" ? (
          <Alert variant="destructive">
            <AlertTitle>This invitation cannot be accepted</AlertTitle>
            <AlertDescription>
              The invitation’s permissions are no longer available. Ask the lender for a new
              invitation.
            </AlertDescription>
          </Alert>
        ) : (
          <Button
            loading={busy}
            disabled={busy || !data.canAccept || session.authenticationMethod !== "email_link"}
            onClick={() => void accept()}
          >
            Accept invitation
          </Button>
        )}
        {Boolean(error) && <ErrorNotice error={error} />}
        <div>
          <Link className="text-sm underline underline-offset-4" to={home}>
            Your applications
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
