import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@keycade/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@keycade/ui/components/dropdown-menu";
import { EmptyState } from "@keycade/ui/components/empty-state";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { StatusPill, type StatusTone } from "@keycade/ui/components/status-pill";
import { cn } from "cn";
import {
  Building2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  EllipsisVertical,
  Info,
  KeyRound,
  Link2,
  ListChecks,
  type LucideIcon,
  Mail,
  Plus,
  RotateCcw,
  Send,
  UserMinus,
  UserPlus,
  UsersRound,
  XCircle,
} from "lucide-react";
import { type FormEvent, Fragment, type ReactNode, useId, useRef, useState } from "react";

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
type Participant = ParticipantsData["participants"][number];
type Invitation = ParticipantsData["invitations"][number];
type Relationship = ParticipantsData["relationships"][number];
export type AssignableTask = {
  id: string;
  title: string;
  revision: number;
  assigneeParticipantId?: string | null;
  assigneeName: string | null;
};
export type TaskAssignmentChange = {
  taskId: string;
  expectedRevision: number;
  participantId: string | null;
};
export const participantRoleLabels: Record<Role, string> = {
  applicant_admin: "Applicant administrator",
  owner: "Owner",
  adviser: "Adviser",
};
export const participantScopeLabel = (scope: Scope) =>
  scope === "full" ? "Application access" : "Assigned tasks and permitted documents";
const roleOptions: { value: Role; label: string; description: string }[] = [
  {
    value: "adviser",
    label: "Adviser",
    description: "A lawyer or accountant. Sees a limited summary and only the tasks you assign.",
  },
  {
    value: "owner",
    label: "Owner",
    description: "A business owner. Sees a limited summary and only the tasks you assign.",
  },
  {
    value: "applicant_admin",
    label: "Applicant administrator",
    description:
      "Manages this application. Other people’s private identity information stays restricted.",
  },
];
const invitationStatusLabels = {
  pending: "Invitation pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Invitation expired",
};
const deliveryStatusLabels = {
  queued: "Email queued",
  sending: "Email sending",
  delivered: "Email delivered to local inbox",
  failed: "Email delivery failed — resend to try again",
  disabled: "Email delivery is unavailable in this environment",
};
const displayDate = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

type DialogState =
  | { kind: "invite" }
  | { kind: "owner" }
  | { kind: "remove"; participant: Participant }
  | { kind: "revoke"; invitation: Invitation }
  | { kind: "link"; relationship: Relationship }
  | { kind: "tasks"; participant: Participant };
type MenuAction = {
  label: string;
  icon: LucideIcon;
  onSelect: (trigger: HTMLElement | null) => void;
  destructive?: boolean;
};

export function ParticipantsManager({
  data,
  mutate,
  errorMessage,
  availableTasks = [],
  assignTasks,
}: {
  data: ParticipantsData;
  availableTasks?: AssignableTask[];
  mutate: (path: string, body: object) => Promise<void>;
  errorMessage: (error: unknown) => string;
  /** Staff hosts reassign unfinished tasks; omit it where task assignment is unavailable. */
  assignTasks?: (changes: TaskAssignmentChange[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  async function save(path: string, body: object, message: string) {
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
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(null);
    }
  }
  // Dialog forms stay open with their entries when a save fails.
  async function saveAndClose(path: string, body: object, message: string) {
    if (await save(path, body, message)) setDialogOpen(false);
  }
  function open(next: DialogState, trigger: HTMLElement | null) {
    returnFocus.current = trigger;
    setError(null);
    setNotice(null);
    setDialog(next);
    setDialogOpen(true);
  }
  const active = data.participants.filter((person) => person.status === "active");
  const openInvitations = data.canInvite
    ? data.invitations.filter(
        (invitation) => invitation.status === "pending" || invitation.status === "expired",
      )
    : [];
  const history = [
    ...data.participants
      .filter((person) => person.status === "revoked")
      .map((person) => ({
        id: person.id,
        name: person.displayName,
        detail: `${participantRoleLabels[person.role]} · Access removed`,
      })),
    ...(data.canInvite ? data.invitations : [])
      .filter((invitation) => invitation.status === "accepted" || invitation.status === "revoked")
      .map((invitation) => ({
        id: invitation.id,
        name: invitation.email,
        detail: `${participantRoleLabels[invitation.role]} · Invitation ${invitation.status}`,
      })),
  ];
  const assignedCount = (participantId: string) =>
    availableTasks.filter((task) => task.assigneeParticipantId === participantId).length;
  return (
    <div className="space-y-10">
      {notice && (
        <Alert variant="success" role="status">
          <CircleCheck aria-hidden="true" />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && !dialog && <SaveError message={error} />}
      {!data.canInvite && (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Your application access</AlertTitle>
          <AlertDescription>
            Your lender invites collaborators and assigns their tasks. Contact your lender to invite
            someone to this application.
          </AlertDescription>
        </Alert>
      )}
      <section aria-labelledby="participants-people" className="space-y-4">
        <Heading
          id="participants-people"
          title="People with portal access"
          description="Access applies to this application only. Removing access takes effect immediately; prior contributions stay in the application history."
          action={
            data.canInvite && (
              <Button
                disabled={Boolean(busy)}
                onClick={(event) => open({ kind: "invite" }, event.currentTarget)}
              >
                <UserPlus aria-hidden="true" data-icon="inline-start" />
                Invite participant
              </Button>
            )
          }
        />
        {active.length || openInvitations.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">
            {active.map((participant) => (
              <PersonCard
                key={participant.id}
                avatar={<Initials name={participant.displayName} />}
                name={
                  <>
                    {participant.displayName}
                    {participant.isSelf && (
                      <span className="font-normal text-muted-foreground"> (you)</span>
                    )}
                  </>
                }
                detail={participant.email}
                menuLabel={`Actions for ${participant.displayName}`}
                busy={Boolean(busy)}
                meta={
                  <>
                    <Meta icon={KeyRound}>
                      {participant.scope === "full"
                        ? "Full application access"
                        : "Assigned tasks only"}
                    </Meta>
                    {assignTasks && (
                      <Meta icon={ListChecks}>
                        {assignedCount(participant.id)}{" "}
                        {assignedCount(participant.id) === 1 ? "open task" : "open tasks"}
                      </Meta>
                    )}
                  </>
                }
                actions={[
                  ...(assignTasks
                    ? [
                        {
                          label: "Edit assigned tasks",
                          icon: ListChecks,
                          onSelect: (trigger: HTMLElement | null) =>
                            open({ kind: "tasks", participant }, trigger),
                        },
                      ]
                    : []),
                  ...(data.canManage && !participant.isSelf
                    ? [
                        {
                          label: "Remove access",
                          icon: UserMinus,
                          destructive: true,
                          onSelect: (trigger: HTMLElement | null) =>
                            open({ kind: "remove", participant }, trigger),
                        },
                      ]
                    : []),
                ]}
              >
                <Badge variant="outline">{participantRoleLabels[participant.role]}</Badge>
              </PersonCard>
            ))}
            {openInvitations.map((invitation) => (
              <PersonCard
                key={invitation.id}
                pending
                avatar={
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  >
                    <Mail className="size-[1.125rem]" />
                  </span>
                }
                name={invitation.email}
                detail={
                  invitation.status === "pending"
                    ? `Invited · Expires ${displayDate(invitation.expiresAt)}`
                    : `Expired ${displayDate(invitation.expiresAt)}`
                }
                menuLabel={`Actions for invitation to ${invitation.email}`}
                busy={Boolean(busy)}
                meta={
                  invitation.taskAssignments.length > 0 && (
                    <Meta icon={ListChecks}>
                      {invitation.taskAssignments.length}{" "}
                      {invitation.taskAssignments.length === 1 ? "task" : "tasks"} selected
                    </Meta>
                  )
                }
                actions={[
                  {
                    label: "Resend invitation",
                    icon: Send,
                    onSelect: () =>
                      void save(
                        `/invitations/${invitation.id}/resend`,
                        {},
                        "A fresh invitation email has been requested.",
                      ),
                  },
                  {
                    label: "Revoke invitation",
                    icon: XCircle,
                    destructive: true,
                    onSelect: (trigger) => open({ kind: "revoke", invitation }, trigger),
                  },
                ]}
                note={
                  invitation.status === "pending" && (
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        invitation.deliveryStatus === "failed" && "text-danger",
                      )}
                    >
                      {invitation.deliveryStatus === "failed" ? (
                        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : (
                        <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                      )}
                      {deliveryStatusLabels[invitation.deliveryStatus]}
                    </span>
                  )
                }
              >
                <StatusPill tone={invitation.status === "pending" ? "warning" : "neutral"}>
                  {invitationStatusLabels[invitation.status]}
                </StatusPill>
                <Badge variant="outline">{participantRoleLabels[invitation.role]}</Badge>
              </PersonCard>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={UsersRound}
            title="No participants are visible for your account."
            description={
              data.canInvite
                ? "Invite an adviser, owner or administrator to collaborate on this application."
                : undefined
            }
          />
        )}
        {history.length > 0 && (
          <Collapsible className="group/history rounded-xl border bg-card">
            <CollapsibleTrigger className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium hover:bg-muted/40 w-full text-left">
              Past access and invitations · {history.length}
              <ChevronDown
                aria-hidden="true"
                className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-open/history:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y border-t">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap justify-between gap-x-4 px-4 py-2.5">
                    <span className="min-w-0 break-all text-sm">{entry.name}</span>
                    <span className="text-xs leading-6 text-muted-foreground">{entry.detail}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>
      {(data.canManage || data.relationships.length > 0) && (
        <section aria-labelledby="participants-owners" className="space-y-4">
          <Heading
            id="participants-owners"
            title="Business owners and contacts"
            description="Recording ownership does not create a user account or grant portal access."
            action={
              data.canManage &&
              data.businessId && (
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={(event) => open({ kind: "owner" }, event.currentTarget)}
                >
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  Record owner
                </Button>
              )
            }
          />
          {data.relationships.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">
              {data.relationships.map((relationship) => {
                const linked = data.participants.find(
                  (person) => person.userId === relationship.userId,
                );
                const linkable = !relationship.userId && relationship.active && active.length > 0;
                return (
                  <PersonCard
                    key={relationship.id}
                    muted={!relationship.active}
                    avatar={
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
                      >
                        {relationship.kind === "owner" ? (
                          initials(relationship.displayName)
                        ) : (
                          <Building2 className="size-[1.125rem]" />
                        )}
                      </span>
                    }
                    name={relationship.displayName}
                    detail={
                      relationship.kind === "owner"
                        ? `Business owner${relationship.ownershipPercent !== null ? ` · ${relationship.ownershipPercent}% ownership` : ""}`
                        : "Business contact"
                    }
                    menuLabel={`Actions for ${relationship.displayName}`}
                    busy={Boolean(busy)}
                    actions={
                      data.canManage
                        ? [
                            ...(linkable
                              ? [
                                  {
                                    label: "Link to participant",
                                    icon: Link2,
                                    onSelect: (trigger: HTMLElement | null) =>
                                      open({ kind: "link", relationship }, trigger),
                                  },
                                ]
                              : []),
                            relationship.active
                              ? {
                                  label: "Mark relationship inactive",
                                  icon: XCircle,
                                  destructive: true,
                                  onSelect: () =>
                                    void save(
                                      `/relationships/${relationship.id}/status`,
                                      { active: false },
                                      "Relationship marked inactive. Its prior task history is preserved.",
                                    ),
                                }
                              : {
                                  label: "Restore relationship",
                                  icon: RotateCcw,
                                  onSelect: () =>
                                    void save(
                                      `/relationships/${relationship.id}/status`,
                                      { active: true },
                                      "Relationship restored. Applicable requirements need fresh review.",
                                    ),
                                },
                          ]
                        : []
                    }
                    note={
                      relationship.userId &&
                      `Linked to ${linked?.displayName ?? "an existing participant"}. Private owner tasks are visible to this person and bank staff.`
                    }
                  >
                    {relationship.active ? (
                      <StatusPill tone={relationship.userId ? "success" : "neutral"}>
                        {relationship.userId ? "Linked portal account" : "No portal account"}
                      </StatusPill>
                    ) : (
                      <Badge variant="secondary">Inactive relationship</Badge>
                    )}
                  </PersonCard>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Building2} title="No owner relationships recorded." />
          )}
          {data.canManage && !data.businessId && (
            <p className="text-sm text-muted-foreground">
              Add a business name during setup before recording owners.
            </p>
          )}
        </section>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next && !busy) setDialogOpen(false);
        }}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setDialog(null);
            setError(null);
          }
        }}
      >
        <DialogContent
          className={cn(dialog?.kind === "invite" && "sm:max-w-xl")}
          finalFocus={() => (returnFocus.current?.isConnected ? returnFocus.current : true)}
        >
          {dialog?.kind === "invite" && (
            <InviteForm
              tasks={availableTasks}
              busy={busy === "/invitations"}
              error={error}
              onSubmit={(body) =>
                void saveAndClose(
                  "/invitations",
                  body,
                  "Invitation saved. The recipient must verify their email and accept before gaining access and receiving the selected tasks.",
                )
              }
            />
          )}
          {dialog?.kind === "owner" && (
            <OwnerForm
              busy={busy === "/relationships"}
              error={error}
              onSubmit={(body) =>
                void saveAndClose(
                  "/relationships",
                  body,
                  "Owner relationship saved. Portal access has not been granted.",
                )
              }
            />
          )}
          {dialog?.kind === "link" && (
            <LinkForm
              relationship={dialog.relationship}
              participants={active}
              busy={Boolean(busy)}
              error={error}
              onSubmit={(userId) =>
                void saveAndClose(
                  `/relationships/${dialog.relationship.id}/user`,
                  { userId },
                  "Owner linked to the existing participant. Portal permissions remain separate.",
                )
              }
            />
          )}
          {dialog?.kind === "tasks" && assignTasks && (
            <TasksForm
              participant={dialog.participant}
              tasks={availableTasks}
              busy={busy === "assignments"}
              error={error}
              onSubmit={async (changes) => {
                setBusy("assignments");
                setError(null);
                try {
                  await assignTasks(changes);
                  setNotice(
                    `Task assignments saved for ${dialog.participant.displayName}. Unchecked tasks are now unassigned.`,
                  );
                  setDialogOpen(false);
                } catch (failure) {
                  setError(errorMessage(failure));
                } finally {
                  setBusy(null);
                }
              }}
            />
          )}
          {dialog?.kind === "remove" && (
            <Confirm
              title={`Remove ${dialog.participant.displayName}’s access?`}
              description="They lose access to this application immediately and any unfinished assignments become unassigned. Their prior contributions stay in the application history."
              action="Remove access"
              busy={Boolean(busy)}
              error={error}
              onConfirm={() =>
                void saveAndClose(
                  `/${dialog.participant.id}/remove`,
                  {},
                  "Participant access removed. Any unfinished assignments are now unassigned.",
                )
              }
            />
          )}
          {dialog?.kind === "revoke" && (
            <Confirm
              title="Revoke this invitation?"
              description={`${dialog.invitation.email} will no longer be able to accept it. You can send a new invitation later.`}
              action="Revoke invitation"
              busy={Boolean(busy)}
              error={error}
              onConfirm={() =>
                void saveAndClose(
                  `/invitations/${dialog.invitation.id}/revoke`,
                  {},
                  "Invitation revoked. It can no longer be accepted.",
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonCard({
  avatar,
  name,
  detail,
  menuLabel,
  actions,
  busy,
  meta,
  note,
  pending = false,
  muted = false,
  children,
}: {
  avatar: ReactNode;
  name: ReactNode;
  detail: string;
  menuLabel: string;
  actions: MenuAction[];
  busy: boolean;
  meta?: ReactNode;
  note?: ReactNode;
  pending?: boolean;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs",
        pending && "border-dashed bg-card/70 shadow-none",
        muted && "bg-muted/40 shadow-none",
      )}
    >
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1 pt-0.5">
          <p
            className={cn("leading-6 font-medium wrap-anywhere", muted && "text-muted-foreground")}
          >
            {name}
          </p>
          <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">{detail}</p>
        </div>
        <ActionsMenu label={menuLabel} actions={actions} disabled={busy} />
      </div>
      <div className="mt-auto space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        {meta && <div className="flex flex-wrap gap-x-4 gap-y-1">{meta}</div>}
        {note && <div className="text-xs leading-5 text-muted-foreground">{note}</div>}
      </div>
    </li>
  );
}

function Heading({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl flex-1 basis-72 space-y-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm leading-6 text-pretty text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Meta({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

function Initials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-sm font-semibold text-info"
    >
      {initials(name)}
    </span>
  );
}

function ActionsMenu({
  label,
  actions,
  disabled,
}: {
  label: string;
  actions: MenuAction[];
  disabled: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="-mt-1 -mr-2 text-muted-foreground"
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action.label}>
            {action.destructive && index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              onClick={() => action.onSelect(trigger.current)}
            >
              <action.icon aria-hidden="true" />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaveError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>We couldn’t save that change</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function Footer({ busy, submit }: { busy: boolean; submit: string }) {
  return (
    <DialogFooter>
      <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
        Cancel
      </DialogClose>
      <Button type="submit" loading={busy}>
        {submit}
      </Button>
    </DialogFooter>
  );
}

function InviteForm({
  tasks,
  busy,
  error,
  onSubmit,
}: {
  tasks: AssignableTask[];
  busy: boolean;
  error: string | null;
  onSubmit: (body: object) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("adviser");
  const [taskAssignments, setTaskAssignments] = useState<
    { taskId: string; expectedRevision: number }[]
  >([]);
  const scope: Scope = role === "applicant_admin" ? "full" : "assigned";
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit({ email: email.trim(), role, scope, taskAssignments, documentIds: [] });
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite a collaborator</DialogTitle>
        <DialogDescription>
          Review the role and access before sending. An invitation never grants access to other
          applications or another person’s private identity information.
        </DialogDescription>
      </DialogHeader>
      {error && <SaveError message={error} />}
      <div className="space-y-2">
        <label htmlFor={`${id}-email`} className="text-sm font-medium">
          Email address
        </label>
        <Input
          id={`${id}-email`}
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          placeholder="name@example.test"
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Role</legend>
        {roleOptions.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/25 has-checked:border-info has-checked:bg-info-soft/60 has-checked:ring-1 has-checked:ring-info has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name={`${id}-role`}
              value={option.value}
              className="mt-1 size-4 shrink-0 accent-info"
              checked={role === option.value}
              disabled={busy}
              aria-labelledby={`${id}-role-${option.value}`}
              aria-describedby={`${id}-role-${option.value}-hint`}
              onChange={() => setRole(option.value)}
            />
            <span className="min-w-0 space-y-0.5">
              <span id={`${id}-role-${option.value}`} className="block text-sm font-medium">
                {option.label}
              </span>
              <span
                id={`${id}-role-${option.value}-hint`}
                className="block text-xs leading-5 text-muted-foreground"
              >
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <KeyRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">
            Access: {participantScopeLabel(scope)}.
          </span>{" "}
          {scope === "assigned"
            ? "They can only use tasks and documents explicitly assigned or permitted to them."
            : "Only the lender can invite collaborators."}
        </span>
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tasks to complete</legend>
        <p className="text-xs leading-5 text-muted-foreground">
          Selected tasks are assigned when they accept, replacing any current assignee. Private
          owner tasks and signing requests are managed separately. You can also assign tasks later.
        </p>
        <TaskChecklist
          tasks={tasks}
          busy={busy}
          checked={(taskId) => taskAssignments.some((selection) => selection.taskId === taskId)}
          onToggle={(task, checked) =>
            setTaskAssignments((current) =>
              checked
                ? [...current, { taskId: task.id, expectedRevision: task.revision }]
                : current.filter((selection) => selection.taskId !== task.id),
            )
          }
          empty="No unfinished tasks are available to assign. You can invite this person now and assign tasks later."
        />
      </fieldset>
      <Footer busy={busy} submit="Send invitation" />
    </form>
  );
}

function TaskChecklist({
  tasks,
  busy,
  checked,
  onToggle,
  empty,
  currentParticipantId,
}: {
  tasks: AssignableTask[];
  busy: boolean;
  checked: (taskId: string) => boolean;
  onToggle: (task: AssignableTask, checked: boolean) => void;
  empty: string;
  currentParticipantId?: string;
}) {
  const id = useId();
  if (!tasks.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  return (
    <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
      {tasks.map((task) => (
        <li key={task.id}>
          <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 has-checked:bg-info-soft/40">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-info"
              checked={checked(task.id)}
              disabled={busy}
              aria-labelledby={`${id}-${task.id}`}
              onChange={(event) => onToggle(task, event.target.checked)}
            />
            <span className="min-w-0">
              <span id={`${id}-${task.id}`} className="block text-sm break-words">
                {task.title}
              </span>
              {task.assigneeName && task.assigneeParticipantId !== currentParticipantId && (
                <span className="block text-xs text-muted-foreground">
                  Currently assigned to {task.assigneeName}
                </span>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function TasksForm({
  participant,
  tasks,
  busy,
  error,
  onSubmit,
}: {
  participant: Participant;
  tasks: AssignableTask[];
  busy: boolean;
  error: string | null;
  onSubmit: (changes: TaskAssignmentChange[]) => void;
}) {
  const [selected, setSelected] = useState(
    () =>
      new Set(
        tasks
          .filter((task) => task.assigneeParticipantId === participant.id)
          .map((task) => task.id),
      ),
  );
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        // Compare against the latest list so a retry sends only the changes still needed.
        onSubmit(
          tasks.flatMap((task) => {
            const assigned = task.assigneeParticipantId === participant.id;
            if (selected.has(task.id) === assigned) return [];
            return [
              {
                taskId: task.id,
                expectedRevision: task.revision,
                participantId: assigned ? null : participant.id,
              },
            ];
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit assigned tasks</DialogTitle>
        <DialogDescription>
          Choose the unfinished tasks {participant.displayName} should complete. Checking a task
          replaces its current assignee; unchecking leaves it unassigned.
        </DialogDescription>
      </DialogHeader>
      {error && <SaveError message={error} />}
      <TaskChecklist
        tasks={tasks}
        busy={busy}
        currentParticipantId={participant.id}
        checked={(taskId) => selected.has(taskId)}
        onToggle={(task, checked) =>
          setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(task.id);
            else next.delete(task.id);
            return next;
          })
        }
        empty="No unfinished tasks are available to assign."
      />
      <Footer busy={busy} submit="Save assignments" />
    </form>
  );
}

function OwnerForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (body: object) => void;
}) {
  const id = useId();
  const [ownerName, setOwnerName] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          displayName: ownerName.trim(),
          kind: "owner",
          ownershipPercent: ownershipPercent.trim() || null,
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Record an owner</DialogTitle>
        <DialogDescription>
          Recording ownership does not create a user account or grant portal access.
        </DialogDescription>
      </DialogHeader>
      {error && <SaveError message={error} />}
      <div className="space-y-2">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Owner name
        </label>
        <Input
          id={`${id}-name`}
          value={ownerName}
          required
          maxLength={160}
          disabled={busy}
          onChange={(event) => setOwnerName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-percent`} className="text-sm font-medium">
          Ownership percentage (optional)
        </label>
        <Input
          id={`${id}-percent`}
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={ownershipPercent}
          disabled={busy}
          onChange={(event) => setOwnershipPercent(event.target.value)}
        />
      </div>
      <Footer busy={busy} submit="Save owner" />
    </form>
  );
}

function LinkForm({
  relationship,
  participants,
  busy,
  error,
  onSubmit,
}: {
  relationship: Relationship;
  participants: Participant[];
  busy: boolean;
  error: string | null;
  onSubmit: (userId: string) => void;
}) {
  const id = useId();
  const [userId, setUserId] = useState("");
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (userId) onSubmit(userId);
      }}
    >
      <DialogHeader>
        <DialogTitle>Link {relationship.displayName} to a participant</DialogTitle>
        <DialogDescription>
          Choose the owner’s existing portal account. Linking shows private owner tasks to that
          person; their portal permissions stay the same.
        </DialogDescription>
      </DialogHeader>
      {error && <SaveError message={error} />}
      <div className="space-y-2">
        <label htmlFor={`${id}-user`} className="text-sm font-medium">
          Participant
        </label>
        <NativeSelect
          id={`${id}-user`}
          className="w-full"
          required
          value={userId}
          disabled={busy}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Choose the owner’s existing account</option>
          {participants.map((person) => (
            <option key={person.id} value={person.userId}>
              {person.displayName}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Footer busy={busy} submit="Link owner" />
    </form>
  );
}

function Confirm({
  title,
  description,
  action,
  busy,
  error,
  onConfirm,
}: {
  title: string;
  description: string;
  action: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {error && <SaveError message={error} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
          Cancel
        </DialogClose>
        <Button type="button" variant="destructive" loading={busy} onClick={onConfirm}>
          {action}
        </Button>
      </DialogFooter>
    </>
  );
}
