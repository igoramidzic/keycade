import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { type FormEvent, useRef, useState } from "react";

type Role = "applicant_admin" | "owner" | "adviser";
type Scope = "full" | "assigned";
export type ParticipantsData = {
  applicationId: string;
  businessId: string | null;
  canManage: boolean;
  canInvite: boolean;
  participants: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role: Role;
    scope: Scope;
    taskIds: string[];
    documentIds: string[];
    status: "active" | "revoked";
    isSelf: boolean;
  }[];
  relationships: {
    id: string;
    displayName: string;
    kind: "owner" | "contact";
    ownershipPercent: string | null;
    userId: string | null;
    active: boolean;
  }[];
  invitations: {
    id: string;
    email: string;
    role: Role;
    scope: Scope;
    taskIds: string[];
    documentIds: string[];
    status: "pending" | "accepted" | "revoked" | "expired";
    taskAssignments: { taskId: string; expectedRevision: number }[];
    expiresAt: string;
    deliveryStatus: "queued" | "sending" | "delivered" | "failed" | "disabled";
  }[];
};
export const participantRoleLabels: Record<Role, string> = {
  applicant_admin: "Applicant administrator",
  owner: "Owner",
  adviser: "Adviser",
};
export const participantScopeLabel = (scope: Scope) =>
  scope === "full" ? "Application access" : "Assigned tasks and permitted documents";
const invitationStatusLabels = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};
const deliveryStatusLabels = {
  queued: "Email queued",
  sending: "Email sending",
  delivered: "Email delivered to local inbox",
  failed: "Email delivery failed — resend to try again",
  disabled: "Email delivery is unavailable in this environment",
};

export function ParticipantsManager({
  data,
  mutate,
  errorMessage,
  availableTasks = [],
}: {
  data: ParticipantsData;
  availableTasks?: { id: string; title: string; revision: number; assigneeName: string | null }[];
  mutate: (path: string, body: object) => Promise<void>;
  errorMessage: (error: unknown) => string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("adviser");
  const [scope, setScope] = useState<Scope>("assigned");
  const [taskAssignments, setTaskAssignments] = useState<
    { taskId: string; expectedRevision: number }[]
  >([]);
  const [ownerName, setOwnerName] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  async function save(path: string, body: object, message: string, done?: () => void) {
    const operation = JSON.stringify({ path, body });
    let idempotencyKey = keys.current.get(operation);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(operation, idempotencyKey);
    }
    setBusy(path);
    setError(null);
    setNotice(null);
    try {
      await mutate(path, { ...body, idempotencyKey });
      keys.current.delete(operation);
      setNotice(message);
      done?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(
      "/invitations",
      {
        email: email.trim(),
        role,
        scope,
        taskAssignments,
        documentIds: [],
      },
      "Invitation saved. The recipient must verify their email and accept before gaining access and receiving the selected tasks.",
      () => {
        setEmail("");
        setTaskAssignments([]);
      },
    );
  }
  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>We couldn’t save that change</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {!data.canInvite && (
        <Alert>
          <AlertTitle>Your application access</AlertTitle>
          <AlertDescription>
            Your lender invites collaborators and assigns their tasks. Contact your lender to invite
            someone to this application.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>People with portal access</h2>
          </CardTitle>
          <CardDescription>
            Access applies to this application only. Removing access takes effect immediately; prior
            contributions stay in the application history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.participants.length ? (
            <ul className="divide-y">
              {data.participants.map((participant) => (
                <li
                  key={participant.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0 space-y-2">
                    <p className="break-words font-medium">
                      {participant.displayName}
                      {participant.isSelf ? " (you)" : ""}
                    </p>
                    <p className="break-all text-sm text-muted-foreground">{participant.email}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{participantRoleLabels[participant.role]}</Badge>
                      <Badge variant="outline">{participantScopeLabel(participant.scope)}</Badge>
                      <Badge variant="secondary">
                        {participant.status === "active" ? "Active" : "Revoked"}
                      </Badge>
                    </div>
                  </div>
                  {data.canManage && participant.status === "active" && !participant.isSelf && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void save(
                          `/${participant.id}/remove`,
                          {},
                          "Participant access removed. Any unfinished assignments are now unassigned.",
                        )
                      }
                    >
                      Remove access
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No participants are visible for your account.
            </p>
          )}
        </CardContent>
      </Card>
      {data.canInvite && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invite a collaborator</h2>
            </CardTitle>
            <CardDescription>
              Review the role and access before sending. An invitation never grants access to other
              applications or another person’s private identity information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={invite}>
              <div className="space-y-2">
                <label htmlFor="invite-email" className="text-sm font-medium">
                  Email address
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                  value={email}
                  disabled={Boolean(busy)}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="invite-role" className="text-sm font-medium">
                  Role
                </label>
                <NativeSelect
                  id="invite-role"
                  className="w-full"
                  value={role}
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    const selected = event.target.value as Role;
                    setRole(selected);
                    setScope(selected === "applicant_admin" ? "full" : "assigned");
                  }}
                >
                  <option value="adviser">Adviser (lawyer or accountant)</option>
                  <option value="owner">Owner</option>
                  <option value="applicant_admin">Applicant administrator</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <label htmlFor="invite-scope" className="text-sm font-medium">
                  Access scope
                </label>
                <NativeSelect
                  id="invite-scope"
                  className="w-full"
                  value={scope}
                  disabled={Boolean(busy) || role !== "applicant_admin"}
                  onChange={(event) => setScope(event.target.value as Scope)}
                >
                  {role !== "applicant_admin" && (
                    <option value="assigned">Assigned tasks and permitted documents</option>
                  )}
                  {role === "applicant_admin" && <option value="full">Application access</option>}
                </NativeSelect>
                <p className="text-sm leading-6 text-muted-foreground">
                  {scope === "assigned"
                    ? "The recipient can see a limited application summary. They can only use tasks and documents explicitly assigned or permitted to them."
                    : "The recipient can manage this application. Only the lender can invite collaborators. Other people’s private identity information remains restricted."}
                </p>
              </div>
              <fieldset className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">Tasks to complete</legend>
                <p className="text-xs leading-5 text-muted-foreground">
                  Selected tasks will be assigned to this person when they accept, replacing any
                  current assignee. Private owner tasks and signing requests are managed separately.
                  You can also assign tasks later from Tasks.
                </p>
                {availableTasks.length ? (
                  availableTasks.map((task) => (
                    <label key={task.id} className="flex items-start gap-2 text-sm">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={taskAssignments.some((selection) => selection.taskId === task.id)}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                          setTaskAssignments((current) =>
                            event.target.checked
                              ? [...current, { taskId: task.id, expectedRevision: task.revision }]
                              : current.filter((selection) => selection.taskId !== task.id),
                          )
                        }
                      />
                      <span>
                        {task.title}
                        {task.assigneeName && (
                          <span className="block text-xs text-muted-foreground">
                            Currently assigned to {task.assigneeName}
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No unfinished tasks are available to assign. You can invite this person now and
                    assign tasks later.
                  </p>
                )}
              </fieldset>
              <Button type="submit" disabled={Boolean(busy)}>
                {busy === "/invitations" ? "Sending…" : "Send invitation"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {data.canInvite && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invitations</h2>
            </CardTitle>
            <CardDescription>
              Pending, expired, and revoked invitations provide no portal access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.invitations.length ? (
              <ul className="divide-y">
                {data.invitations.map((invitation) => (
                  <li key={invitation.id} className="space-y-3 py-4">
                    <p className="break-all font-medium">{invitation.email}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{invitationStatusLabels[invitation.status]}</Badge>
                      <Badge variant="outline">{participantRoleLabels[invitation.role]}</Badge>
                      <Badge variant="outline">{participantScopeLabel(invitation.scope)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {invitation.taskAssignments.length}{" "}
                      {invitation.taskAssignments.length === 1 ? "task" : "tasks"} selected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(invitation.expiresAt).toLocaleString()}
                    </p>
                    {invitation.status === "pending" && (
                      <p className="text-sm text-muted-foreground">
                        {deliveryStatusLabels[invitation.deliveryStatus]}
                      </p>
                    )}
                    {(invitation.status === "pending" || invitation.status === "expired") && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void save(
                              `/invitations/${invitation.id}/resend`,
                              {},
                              "A fresh invitation email has been requested.",
                            )
                          }
                        >
                          Resend invitation
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void save(
                              `/invitations/${invitation.id}/revoke`,
                              {},
                              "Invitation revoked. It can no longer be accepted.",
                            )
                          }
                        >
                          Revoke invitation
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No invitations yet.</p>
            )}
          </CardContent>
        </Card>
      )}
      {(data.canManage || data.relationships.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Business owners and contacts</h2>
            </CardTitle>
            <CardDescription>
              Recording ownership does not create a user account or grant portal access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {data.relationships.length ? (
              <ul className="divide-y">
                {data.relationships.map((relationship) => (
                  <li key={relationship.id} className="space-y-2 py-3">
                    <p className="break-words font-medium">{relationship.displayName}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {relationship.kind === "owner" ? "Business owner" : "Business contact"}
                      </Badge>
                      {relationship.ownershipPercent !== null && (
                        <Badge variant="secondary">
                          {relationship.ownershipPercent}% ownership
                        </Badge>
                      )}
                      {!relationship.active && (
                        <Badge variant="secondary">Inactive relationship</Badge>
                      )}
                    </div>
                    {data.canManage && (
                      <RelationshipControls
                        relationship={relationship}
                        participants={data.participants}
                        busy={Boolean(busy)}
                        save={save}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No owner relationships recorded.</p>
            )}
            {data.canManage &&
              (data.businessId ? (
                <form
                  className="space-y-4 border-t pt-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(
                      "/relationships",
                      {
                        displayName: ownerName.trim(),
                        kind: "owner",
                        ownershipPercent: ownershipPercent.trim() || null,
                      },
                      "Owner relationship saved. Portal access has not been granted.",
                      () => {
                        setOwnerName("");
                        setOwnershipPercent("");
                      },
                    );
                  }}
                >
                  <h3 className="font-medium">Record an owner</h3>
                  <div className="space-y-2">
                    <label htmlFor="owner-name" className="text-sm font-medium">
                      Owner name
                    </label>
                    <Input
                      id="owner-name"
                      value={ownerName}
                      required
                      maxLength={160}
                      disabled={Boolean(busy)}
                      onChange={(event) => setOwnerName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="ownership-percent" className="text-sm font-medium">
                      Ownership percentage (optional)
                    </label>
                    <Input
                      id="ownership-percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={ownershipPercent}
                      disabled={Boolean(busy)}
                      onChange={(event) => setOwnershipPercent(event.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={Boolean(busy)}>
                    {busy === "/relationships" ? "Saving…" : "Save owner"}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Add a business name during setup before recording owners.
                </p>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RelationshipControls({
  relationship,
  participants,
  busy,
  save,
}: {
  relationship: ParticipantsData["relationships"][number];
  participants: ParticipantsData["participants"];
  busy: boolean;
  save: (path: string, body: object, message: string) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const linked = participants.find((person) => person.userId === relationship.userId);
  return (
    <div className="space-y-3 pt-2">
      {relationship.userId ? (
        <p className="text-sm text-muted-foreground">
          Linked to {linked?.displayName ?? "an existing participant"}. Private owner tasks are
          visible to this person and bank staff.
        </p>
      ) : (
        relationship.active && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (userId)
                void save(
                  `/relationships/${relationship.id}/user`,
                  { userId },
                  "Owner linked to the existing participant. Portal permissions remain separate.",
                );
            }}
          >
            <div className="min-w-0 flex-1 space-y-2">
              <label className="text-sm" htmlFor={`owner-user-${relationship.id}`}>
                Link {relationship.displayName} to a participant
              </label>
              <NativeSelect
                id={`owner-user-${relationship.id}`}
                className="w-full"
                required
                value={userId}
                disabled={busy}
                onChange={(event) => setUserId(event.target.value)}
              >
                <option value="">Choose the owner’s existing account</option>
                {participants
                  .filter((person) => person.status === "active")
                  .map((person) => (
                    <option key={person.id} value={person.userId}>
                      {person.displayName}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={busy || !userId}>
              Link owner
            </Button>
          </form>
        )
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void save(
            `/relationships/${relationship.id}/status`,
            { active: !relationship.active },
            relationship.active
              ? "Relationship marked inactive. Its prior task history is preserved."
              : "Relationship restored. Applicable requirements need fresh review.",
          )
        }
      >
        {relationship.active ? "Mark relationship inactive" : "Restore relationship"}
      </Button>
    </div>
  );
}
