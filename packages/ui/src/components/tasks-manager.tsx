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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import { Input } from "@keycade/ui/components/input";
import { NativeSelect } from "@keycade/ui/components/native-select";
import {
  SecureTaskInput,
  type SecureTaskInputData,
  type TaskInputKind,
} from "@keycade/ui/components/secure-task-input";
import { textareaClassName } from "@keycade/ui/components/textarea";
import { workflowName, workflowText } from "@keycade/ui/lib/workflow-text";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleDot,
  CircleMinus,
  Eye,
  Plus,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

type Stage = "submission" | "approval" | "closing";
type State = "open" | "submitted" | "needs_changes" | "completed" | "waived" | "cancelled";
export type TaskSummary = {
  id: string;
  title: string;
  description: string;
  stage: Stage;
  required: boolean;
  state: State;
  source: "rule" | "manual";
  visibility: "shared" | "assigned" | "private";
  reason: string;
  stableKey: string;
  occurrence: number;
  revision: number;
  evidenceRevision: number;
  assigneeParticipantId: string | null;
  assignedToYou?: boolean;
  subjectUserId: string | null;
  dueAt: string | null;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  inputKind?: TaskInputKind;
  signatureEnvelopeId?: string | null;
  secureInput?: SecureTaskInputData | null;
};
export type TaskDetailData = TaskSummary & {
  answer: string | null;
  answers: {
    id: string;
    answer: string;
    evidenceRevision: number;
    createdAt: string;
    authorUserId: string;
  }[];
  reviews: {
    id: string;
    decision: "completed" | "needs_changes" | "waived";
    reason: string;
    evidenceRevision: number;
    createdAt: string;
  }[];
  assignments: { participantId: string | null; createdAt: string }[];
};
export type TasksData = {
  applicationId: string;
  simulation: true;
  canManage: boolean;
  tasks: TaskDetailData[];
  progress: {
    total: number;
    completed: number;
    required: number;
    requiredCompleted: number;
    byStage: {
      stage: Stage;
      total: number;
      completed: number;
      required: number;
      requiredCompleted: number;
    }[];
  };
  assignees: { id: string; userId: string; displayName: string }[];
};
const stateLabels: Record<State, string> = {
  open: "Open",
  submitted: "Submitted",
  needs_changes: "Changes requested",
  completed: "Completed",
  waived: "Waived",
  cancelled: "No longer required",
};
const stageLabels: Record<Stage, string> = {
  submission: "Submission",
  approval: "Approval",
  closing: "Closing",
};
const stageOrder: Record<Stage, number> = { submission: 0, approval: 1, closing: 2 };
/** Completed by its assignee, whether or not the lender has reviewed it yet. */
const done = (task: TaskSummary) =>
  task.state === "completed" || task.state === "waived" || task.state === "submitted";
const textareaClass = textareaClassName;
const displayDate = (date: string) => new Date(date).toLocaleDateString();
const dateInput = (date: string | null) => date?.slice(0, 10) ?? "";
const dueDate = (date: string) => (date ? new Date(`${date}T23:59:59.000Z`).toISOString() : null);

export function TaskProgress({
  progress,
  compact = false,
}: {
  progress: TasksData["progress"];
  compact?: boolean;
}) {
  return (
    <div className="space-y-3" aria-label="Visible task progress">
      <p className="text-sm">
        <span className="font-medium">
          {progress.requiredCompleted} of {progress.required}
        </span>{" "}
        required tasks satisfied
        {" · "}
        {progress.completed} of {progress.total} total
      </p>
      {!compact && (
        <div className="flex flex-wrap gap-2">
          {progress.byStage.map((stage) => (
            <Badge key={stage.stage} variant="outline">
              {stageLabels[stage.stage]}: {stage.requiredCompleted}/{stage.required} required
            </Badge>
          ))}
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Counts include only tasks you can access. Completed tasks and waivers count toward progress.{" "}
        Task progress alone does not submit or approve this application.
      </p>
    </div>
  );
}

export function TasksManager({
  data,
  mutate,
  reload,
  errorMessage,
  renderDocuments,
  signatureHref,
  initialTaskId,
  borrowerBusinessName,
}: {
  data: TasksData;
  initialTaskId?: string | null;
  borrowerBusinessName?: string;
  mutate: (
    path: string,
    body: object,
    method: "POST" | "PATCH",
  ) => Promise<TaskDetailData | TasksData>;
  reload: () => Promise<TasksData>;
  errorMessage: (error: unknown) => string;
  renderDocuments?: (
    taskId: string,
    onBusyChange: (busy: boolean) => void,
    visibility: TaskSummary["visibility"],
  ) => ReactNode;
  signatureHref?: (envelopeId: string | null) => string;
}) {
  const initialTask = data.tasks.find((task) => task.id === initialTaskId);
  const [selected, setSelected] = useState<string | null>(initialTask?.id ?? null);
  const [detail, setDetail] = useState<TaskDetailData | null>(initialTask ?? null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const busy = saving || uploading;
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{ id: string | null } | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const closingDetails = useRef(new Map<string, TaskDetailData>());
  // The task that just closed keeps its content while its panel animates shut, then unmounts.
  const [closing, setClosing] = useState<string | null>(null);
  const previousSelection = useRef(selected);
  useEffect(() => {
    const prior = previousSelection.current;
    previousSelection.current = selected;
    if (!prior || prior === selected) return;
    setClosing(prior);
    const timer = window.setTimeout(() => setClosing((id) => (id === prior ? null : id)), 250);
    return () => window.clearTimeout(timer);
  }, [selected]);
  const lastRequestedTask = useRef(initialTaskId);
  useEffect(() => {
    // A contextual closing/reminder link may change the requested task while
    // this editor stays mounted. Honor the new intent through the same dirty guard.
    if (lastRequestedTask.current === initialTaskId) return;
    lastRequestedTask.current = initialTaskId;
    if (
      initialTaskId &&
      initialTaskId !== selected &&
      data.tasks.some((task) => task.id === initialTaskId)
    )
      selectTask(initialTaskId);
  });
  useEffect(() => {
    if (pendingSelection) confirmRef.current?.focus();
  }, [pendingSelection]);
  const selectedSummary = data.tasks.find((task) => task.id === selected);
  // Order only by stage, then the server's creation order. A task keeps its place
  // as its state changes, so finishing one never moves the list under the user.
  const visible = data.tasks
    .filter((task) => filter === "all" || task.state !== "cancelled" || task.id === selected)
    .sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage]);
  const staffView = borrowerBusinessName === undefined;
  const groups = [
    {
      title: staffView ? "Private and assigned tasks" : "Your tasks",
      tasks: visible.filter(
        (task) => task.visibility !== "shared" || (!staffView && task.assignedToYou),
      ),
    },
    {
      title: staffView ? "Business tasks" : `Tasks for ${borrowerBusinessName}`,
      tasks: visible.filter(
        (task) => task.visibility === "shared" && (staffView || !task.assignedToYou),
      ),
    },
  ];
  function selectTask(id: string | null) {
    if (hasUnsavedChanges && selectedSummary) {
      setPendingSelection({ id });
      return;
    }
    openTask(id);
  }
  function openTask(id: string | null) {
    // Keep an editing snapshot: a background refresh may flag it stale, but never
    // replace typed answers. Opening a row needs only the already-authorized list.
    setSelected(id);
    setDetail(data.tasks.find((task) => task.id === id) ?? null);
    setDetailError(null);
    setHasUnsavedChanges(false);
    setPendingSelection(null);
    setNotice(null);
  }
  const assignee = (id: string | null) =>
    data.assignees.find((person) => person.id === id)?.displayName ??
    (id ? "Assigned participant" : "Unassigned");
  // Count from the same rows the list shows, so the bar always matches the checkmarks.
  const applicable = data.tasks.filter((task) => task.state !== "cancelled");
  const doneCount = applicable.filter(done).length;
  const requiredLeft = applicable.filter((task) => task.required && !done(task)).length;
  const donePercent = applicable.length ? Math.round((doneCount / applicable.length) * 100) : 0;
  // The list sits directly on the page; each task row is the only card surface.
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Tasks</h2>
          </div>
          {data.canManage && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setCreating(!creating)}
            >
              {!creating && <Plus aria-hidden="true" data-icon="inline-start" />}
              {creating ? "Close new task" : "Add task"}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-48 flex-1 space-y-2">
            <p className="text-sm text-muted-foreground" aria-label="Visible task progress">
              <span className="font-semibold text-foreground tabular-nums">
                {doneCount} of {applicable.length}
              </span>{" "}
              tasks complete
              {requiredLeft > 0
                ? ` · ${requiredLeft} required ${requiredLeft === 1 ? "task" : "tasks"} left`
                : applicable.some((task) => task.required)
                  ? " · All required tasks done"
                  : ""}
            </p>
            <span
              aria-hidden="true"
              className="block h-2 w-full max-w-md overflow-hidden rounded-full bg-border"
            >
              <span
                className="block h-full rounded-full bg-success transition-[width] duration-500"
                style={{ width: `${donePercent}%` }}
              />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="task-filter" className="sr-only">
              Show
            </label>
            <NativeSelect
              id="task-filter"
              size="sm"
              value={filter}
              disabled={busy}
              onChange={(event) => setFilter(event.target.value as "active" | "all")}
            >
              <option value="active">Applicable tasks</option>
              <option value="all">All task history</option>
            </NativeSelect>
          </div>
        </div>
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {creating && data.canManage && (
        <ManualTask
          data={data}
          mutate={mutate}
          errorMessage={errorMessage}
          onBusy={setBusy}
          onCreated={() => {
            setCreating(false);
            setNotice("Task added. Assign a participant to collect an answer.");
          }}
        />
      )}
      {selected && !selectedSummary && (
        <Alert>
          <AlertTitle>Task no longer available</AlertTitle>
          <AlertDescription>
            Your access or this task’s assignment changed. Choose another task from the current
            list.
          </AlertDescription>
        </Alert>
      )}
      {visible.length ? (
        groups
          .filter((group) => group.tasks.length > 0)
          .map((group) => (
            <section key={group.title} className="space-y-3" aria-label={workflowText(group.title)}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{workflowText(group.title)}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.tasks.filter(done).length}/
                  {group.tasks.filter((task) => task.state !== "cancelled").length} complete
                </span>
              </div>
              <ul className="space-y-2">
                {group.tasks.map((task) => {
                  const expanded = selected === task.id;
                  const actionable =
                    task.state === "open" &&
                    (task.canEdit || task.canSubmit || Boolean(task.secureInput?.canEdit));
                  // A task the client completed is complete for them. Staff see the same task
                  // as their own blue review action until they mark it reviewed.
                  const awaitingReview = staffView && task.state === "submitted";
                  const tone = awaitingReview
                    ? "info"
                    : done(task)
                      ? "complete"
                      : task.state === "needs_changes"
                        ? "warning"
                        : task.state === "cancelled"
                          ? "muted"
                          : actionable || staffView
                            ? "info"
                            : "muted";
                  const StatusIcon = awaitingReview
                    ? Eye
                    : done(task)
                      ? Check
                      : task.state === "needs_changes"
                        ? CircleAlert
                        : task.state === "cancelled"
                          ? CircleMinus
                          : actionable
                            ? CircleDot
                            : Circle;
                  // Keep the last opened detail so a card stays filled while it animates closed.
                  if (detail?.id === task.id) closingDetails.current.set(task.id, detail);
                  const shown =
                    detail?.id === task.id
                      ? detail
                      : closing === task.id
                        ? closingDetails.current.get(task.id)
                        : undefined;
                  // A host may return null where its own uploader already covers the task.
                  const taskDocuments =
                    shown &&
                    renderDocuments &&
                    ["answer", "signature"].includes(task.inputKind ?? "answer")
                      ? renderDocuments(task.id, setUploading, task.visibility)
                      : null;
                  return (
                    <li
                      key={task.id}
                      className={cn(
                        "overflow-hidden rounded-xl border bg-card shadow-xs transition-colors",
                        expanded ? "border-info/35 shadow-sm" : "hover:border-foreground/20",
                        task.state === "cancelled" && "bg-muted/40",
                      )}
                    >
                      <Collapsible
                        open={expanded}
                        disabled={busy}
                        onOpenChange={(open) => selectTask(open ? task.id : null)}
                      >
                        <h4>
                          <CollapsibleTrigger
                            id={`task-toggle-${task.id}`}
                            aria-label={workflowText(task.title)}
                            aria-describedby={`task-status-${task.id}`}
                            className={cn(
                              "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 sm:px-5",
                              expanded && "bg-muted/40",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-full",
                                tone === "complete" && "bg-success text-white",
                                tone === "info" && "bg-info-soft text-info",
                                tone === "warning" && "bg-warning-soft text-warning",
                                tone === "muted" && "bg-muted text-muted-foreground",
                              )}
                            >
                              <StatusIcon
                                className="size-[1.125rem]"
                                strokeWidth={StatusIcon === Check ? 2.75 : 2}
                              />
                            </span>
                            <span className="min-w-0 flex-1 space-y-1">
                              <span
                                className={cn(
                                  "block break-words text-sm leading-5 font-medium",
                                  task.state === "cancelled" && "text-muted-foreground",
                                )}
                              >
                                {workflowText(task.title)}
                              </span>
                              <span
                                id={`task-status-${task.id}`}
                                className="block text-xs leading-5 text-muted-foreground"
                              >
                                <span
                                  className={cn(
                                    "font-medium",
                                    tone === "complete" && "text-success",
                                    tone === "info" && "text-info",
                                    tone === "warning" && "text-warning",
                                  )}
                                >
                                  {!staffView && task.state === "open"
                                    ? task.canEdit || task.canSubmit || task.secureInput?.canEdit
                                      ? "Needs your action"
                                      : task.inputKind === "signature"
                                        ? "Signature request"
                                        : "Waiting for assignee"
                                    : task.state === "submitted"
                                      ? staffView
                                        ? "Needs your review"
                                        : "Completed"
                                      : stateLabels[task.state]}
                                </span>{" "}
                                · {stageLabels[task.stage]}
                                {!task.required && " · Optional"}
                                {task.dueAt && ` · Due ${displayDate(task.dueAt)}`}
                              </span>
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          </CollapsibleTrigger>
                        </h4>
                        <CollapsibleContent
                          id={`task-detail-${task.id}`}
                          role="region"
                          aria-labelledby={`task-toggle-${task.id}`}
                        >
                          {(expanded || closing === task.id) && (
                            // A closing task stays visible for the animation but is neither usable
                            // nor announced.
                            <div
                              className="border-t pb-1"
                              inert={!expanded || undefined}
                              aria-hidden={!expanded || undefined}
                            >
                              {pendingSelection && (
                                <div
                                  ref={confirmRef}
                                  tabIndex={-1}
                                  className="px-4 pt-4 outline-none sm:px-5"
                                >
                                  <Alert role="alert">
                                    <AlertTitle>You have unsaved changes</AlertTitle>
                                    <AlertDescription>
                                      <p>
                                        Keep editing this task, or discard your unsaved entries to
                                        continue.
                                      </p>
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={busy}
                                          onClick={() => {
                                            setPendingSelection(null);
                                            document
                                              .getElementById(`task-toggle-${selected}`)
                                              ?.focus();
                                          }}
                                        >
                                          Keep editing
                                        </Button>
                                        <Button
                                          size="sm"
                                          disabled={busy}
                                          onClick={() => {
                                            openTask(pendingSelection.id);
                                            document
                                              .getElementById(
                                                `task-toggle-${pendingSelection.id ?? selected}`,
                                              )
                                              ?.focus();
                                            setPendingSelection(null);
                                            setNotice(null);
                                          }}
                                        >
                                          Discard changes
                                        </Button>
                                      </div>
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}
                              {detailError && (
                                <div className="p-4">
                                  <Alert variant="destructive" role="alert">
                                    <AlertTitle>Saved task could not be reloaded</AlertTitle>
                                    <AlertDescription>
                                      <p>{detailError}</p>
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}
                              {shown && (
                                <>
                                  <TaskDetail
                                    key={`${shown.id}:${reloadCount}`}
                                    task={shown}
                                    signatureHref={signatureHref}
                                    data={data}
                                    busy={busy}
                                    // List refreshes can observe our write before mutate returns
                                    // its detail. Compare only after that write has settled;
                                    // an older list snapshot never makes the editor stale.
                                    stale={!busy && task.revision > shown.revision}
                                    onBusy={setBusy}
                                    onDirtyChange={setHasUnsavedChanges}
                                    assigneeName={assignee(task.assigneeParticipantId)}
                                    errorMessage={errorMessage}
                                    onReload={async () => {
                                      setBusy(true);
                                      setDetailError(null);
                                      try {
                                        const latest = await reload();
                                        setDetail(
                                          latest.tasks.find((current) => current.id === task.id) ??
                                            null,
                                        );
                                        setHasUnsavedChanges(false);
                                        setPendingSelection(null);
                                        setReloadCount((value) => value + 1);
                                      } catch (error) {
                                        setDetailError(errorMessage(error));
                                      } finally {
                                        setBusy(false);
                                      }
                                    }}
                                    mutate={async (path, body, method) => {
                                      const updated = await mutate(path, body, method);
                                      if ("id" in updated) setDetail(updated);
                                      setPendingSelection(null);
                                      return updated;
                                    }}
                                  />
                                  {taskDocuments && (
                                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">{taskDocuments}</div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No {filter === "active" ? "applicable " : ""}tasks are visible for your account.
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Saving answers does not submit or approve this application.
      </p>
    </div>
  );
}

function TaskDetail({
  task,
  data,
  busy,
  stale,
  onBusy,
  mutate,
  errorMessage,
  onReload,
  onDirtyChange,
  assigneeName,
  signatureHref,
}: {
  task: TaskDetailData;
  data: TasksData;
  busy: boolean;
  stale: boolean;
  onBusy: (value: boolean) => void;
  mutate: (
    path: string,
    body: object,
    method: "POST" | "PATCH",
  ) => Promise<TaskDetailData | TasksData>;
  errorMessage: (error: unknown) => string;
  onReload: () => void;
  onDirtyChange: (dirty: boolean) => void;
  assigneeName: string;
  signatureHref?: (envelopeId: string | null) => string;
}) {
  const [answer, setAnswer] = useState(task.answer ?? "");
  const [participantId, setParticipantId] = useState(task.assigneeParticipantId ?? "");
  const [dueAt, setDueAt] = useState(dateInput(task.dueAt));
  const [reason, setReason] = useState("");
  const [secureDirty, setSecureDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which button shows the spinner; every other control is simply disabled while busy.
  const [pending, setPending] = useState<string | null>(null);
  const dirty = answer !== (task.answer ?? "");
  const hasUnsavedChanges =
    secureDirty ||
    dirty ||
    participantId !== (task.assigneeParticipantId ?? "") ||
    dueAt !== dateInput(task.dueAt) ||
    reason.length > 0;
  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);
  async function save(action: string, body: object, method: "POST" | "PATCH", message: string) {
    onBusy(true);
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const updated = await mutate(
        `/${task.id}/${action}`,
        { expectedRevision: task.revision, ...body },
        method,
      );
      if ("id" in updated) {
        setAnswer(updated.answer ?? "");
        setParticipantId(updated.assigneeParticipantId ?? "");
        setDueAt(dateInput(updated.dueAt));
      }
      setNotice(message);
      setReason("");
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      onBusy(false);
      setPending(null);
    }
  }
  const completedNotice = "Task completed. Your lender will follow up if anything needs to change.";
  async function complete() {
    onBusy(true);
    setPending("submit");
    setError(null);
    setNotice(null);
    try {
      let revision = task.revision;
      if (dirty) {
        const saved = await mutate(
          `/${task.id}/answer`,
          { expectedRevision: revision, answer: answer.trim() },
          "PATCH",
        );
        if ("id" in saved) revision = saved.revision;
      }
      const updated = await mutate(`/${task.id}/submit`, { expectedRevision: revision }, "POST");
      if ("id" in updated) setAnswer(updated.answer ?? "");
      setNotice(completedNotice);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      onBusy(false);
      setPending(null);
    }
  }
  const kind = task.inputKind ?? "answer";
  // Readiness confirmations store a fixed choice; their stored instructions describe the
  // underlying API value, so the form asks a plain question and keeps them in Details.
  const choiceAnswer =
    task.visibility === "private" || task.stableKey.startsWith("tax-document-readiness:");
  const latestReview = task.reviews[0];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      {kind !== "answer" && kind !== "tax_authorization" && (
        <p className="text-sm leading-6 text-foreground/90">{workflowText(task.description)}</p>
      )}
      {(error || stale) && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>
            {stale ? "This task has changed" : "We couldn’t save that change"}
          </AlertTitle>
          <AlertDescription>
            <p>{error ?? "A newer revision is available. Your entered answer is still here."}</p>
            <p>Reload the saved task before retrying. Reloading replaces your unsaved entries.</p>
            <Button variant="outline" disabled={busy} onClick={onReload}>
              Reload saved task
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {task.state === "needs_changes" && latestReview?.decision === "needs_changes" && (
        <div className="rounded-lg border border-warning/25 bg-warning-soft/60 px-4 py-3 text-sm">
          <p className="font-medium">Changes requested · {displayDate(latestReview.createdAt)}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {latestReview.reason}
          </p>
        </div>
      )}
      {task.inputKind === "signature" ? (
        <div className="space-y-3 text-sm">
          <p>
            This task is managed by a signature request. All intended signers must sign its current
            document before it can be completed.
          </p>
          {signatureHref && (
            <a
              className="font-medium underline underline-offset-4"
              href={signatureHref(task.signatureEnvelopeId ?? null)}
            >
              View signature request
            </a>
          )}
        </div>
      ) : kind !== "answer" ? (
        <div className="space-y-3">
          <SecureTaskInput
            taskId={task.id}
            kind={task.inputKind as Exclude<TaskInputKind, "answer" | "signature">}
            data={task.secureInput ?? null}
            disabled={busy || stale}
            onDirtyChange={setSecureDirty}
            save={(action, body, message) => save(action, body, "POST", message)}
          />
          {task.canSubmit && (
            <Button
              loading={pending === "submit"}
              disabled={busy || stale || secureDirty || task.evidenceRevision === 0}
              onClick={() => void save("submit", {}, "POST", completedNotice)}
            >
              Complete task
            </Button>
          )}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              "answer",
              { answer: answer.trim() },
              "PATCH",
              "Answer saved. Choose Complete task when you’re ready.",
            );
          }}
        >
          <label htmlFor={`task-answer-${task.id}`} className="block text-sm leading-6">
            {choiceAnswer ? "Are you ready to provide this information?" : task.description}
          </label>
          {choiceAnswer ? (
            <NativeSelect
              id={`task-answer-${task.id}`}
              className="w-full"
              required
              value={answer}
              disabled={busy || !task.canEdit}
              onChange={(event) => setAnswer(event.target.value)}
            >
              <option value="">Choose an answer</option>
              <option value="confirmed">I confirm readiness to provide information</option>
              <option value="needs_help">I need help with this confirmation</option>
            </NativeSelect>
          ) : (
            <textarea
              id={`task-answer-${task.id}`}
              className={textareaClass}
              required
              maxLength={4000}
              value={answer}
              disabled={busy || !task.canEdit}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          {task.canEdit && ["completed", "waived", "submitted"].includes(task.state) && (
            <p className="text-xs leading-5 text-muted-foreground">
              Changing your answer reopens this task until you complete it again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {task.canEdit && (
              <Button
                loading={pending === "answer"}
                type="submit"
                variant="outline"
                disabled={busy || !answer.trim() || !dirty || stale}
              >
                Save answer
              </Button>
            )}
            {(task.canSubmit ||
              (task.canEdit && (dirty || ["open", "needs_changes"].includes(task.state)))) && (
              <Button
                type="button"
                loading={pending === "submit"}
                disabled={busy || !answer.trim() || stale}
                onClick={() => void complete()}
              >
                Complete task
              </Button>
            )}
          </div>
          {!task.canEdit && !task.canSubmit && (
            <p className="text-sm text-muted-foreground">
              {task.state === "submitted" || task.state === "completed"
                ? "This task is complete."
                : task.state === "cancelled"
                  ? "This requirement no longer applies. Its history is preserved."
                  : "Only the authorized assignee can answer and complete this task."}
            </p>
          )}
        </form>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {data.canManage &&
        kind === "answer" &&
        !["completed", "waived", "cancelled"].includes(task.state) && (
          <form
            className="space-y-4 border-t pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                "assignment",
                { participantId: participantId || null, dueAt: dueDate(dueAt) },
                "PATCH",
                "Assignment and due date saved.",
              );
            }}
          >
            <h4 className="text-sm font-semibold">Assignment</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm" htmlFor={`assignee-${task.id}`}>
                  Assigned participant
                </label>
                <NativeSelect
                  id={`assignee-${task.id}`}
                  className="w-full"
                  value={participantId}
                  disabled={busy || stale}
                  onChange={(event) => setParticipantId(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {data.assignees
                    .filter(
                      (person) =>
                        task.visibility !== "private" || person.userId === task.subjectUserId,
                    )
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {workflowName(person.displayName)}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <label className="text-sm" htmlFor={`due-${task.id}`}>
                  Due date (optional)
                </label>
                <Input
                  id={`due-${task.id}`}
                  type="date"
                  value={dueAt}
                  disabled={busy || stale}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" variant="outline" disabled={busy || stale}>
              Save assignment
            </Button>
          </form>
        )}
      {task.canReview && !["completed", "waived", "cancelled"].includes(task.state) && (
        <div className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold">
            {task.state === "submitted" ? "Review completed task" : "Review task"}
          </h4>
          {task.state === "submitted" && (
            <p className="text-xs leading-5 text-muted-foreground">
              The assignee completed this task. Mark it reviewed, or return it for changes to reopen
              it for them.
            </p>
          )}
          <label className="block text-sm" htmlFor={`review-reason-${task.id}`}>
            Review or waiver reason
          </label>
          <textarea
            id={`review-reason-${task.id}`}
            className={textareaClass}
            maxLength={2000}
            value={reason}
            disabled={busy || stale}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {task.state === "submitted" && (
              <>
                <Button
                  disabled={busy || stale || !reason.trim()}
                  onClick={() =>
                    void save(
                      "review",
                      { decision: "completed", reason: reason.trim() },
                      "POST",
                      "Task marked reviewed.",
                    )
                  }
                >
                  Mark reviewed
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || stale || !reason.trim()}
                  onClick={() =>
                    void save(
                      "review",
                      { decision: "needs_changes", reason: reason.trim() },
                      "POST",
                      "Task returned to the assignee for changes.",
                    )
                  }
                >
                  Return for changes
                </Button>
              </>
            )}
            {!["waived", "completed", "cancelled"].includes(task.state) && (
              <Button
                variant="outline"
                disabled={busy || stale || !reason.trim()}
                onClick={() =>
                  void save(
                    "waive",
                    { reason: reason.trim() },
                    "POST",
                    "Task waived with the recorded reason.",
                  )
                }
              >
                Waive task
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A reason is recorded for every review and waiver. Waivers apply to this occurrence only.
          </p>
        </div>
      )}
      <Collapsible className="group/history border-t pt-4">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full text-left">
          <ChevronDown
            aria-hidden="true"
            className="size-4 -rotate-90 transition-transform group-data-open/history:rotate-0"
          />
          Details and history
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-4 text-sm">
            <div className="space-y-1">
              <h4 className="font-medium">Why this applies</h4>
              <p className="leading-6 text-muted-foreground">{task.reason}</p>
            </div>
            {kind === "answer" && choiceAnswer && (
              <p className="leading-6 text-muted-foreground">{workflowText(task.description)}</p>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {task.source === "manual" ? "Staff requested" : "Product requirement"} ·{" "}
              {task.required ? "Required" : "Optional"} · {assigneeName}
              {task.visibility === "private" && " · Owner private"}
              <br />
              Provide the details requested for this task.
            </p>
            {task.answers.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium">Saved answers</h4>
                {task.answers.map((entry) => (
                  <div key={entry.id} className="border-l-2 pl-3">
                    <p className="text-xs text-muted-foreground">
                      Answer {entry.evidenceRevision} · {displayDate(entry.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{entry.answer}</p>
                  </div>
                ))}
              </div>
            )}
            {task.reviews.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium">Reviews</h4>
                {task.reviews.map((review) => (
                  <div key={review.id} className="border-l-2 pl-3">
                    <p>
                      {stateLabels[review.decision]} · Answer {review.evidenceRevision} ·{" "}
                      {displayDate(review.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                      {review.reason}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {!task.answers.length && !task.reviews.length && (
              <p className="text-muted-foreground">No answers or reviews yet.</p>
            )}
            {data.canManage && (
              <p className="text-xs text-muted-foreground">
                Occurrence {task.occurrence} · Record revision {task.revision} · Answer revision{" "}
                {task.evidenceRevision}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ManualTask({
  data,
  mutate,
  errorMessage,
  onBusy,
  onCreated,
}: {
  data: TasksData;
  mutate: (
    path: string,
    body: object,
    method: "POST" | "PATCH",
  ) => Promise<TaskDetailData | TasksData>;
  errorMessage: (error: unknown) => string;
  onBusy: (value: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Stage>("submission");
  const [required, setRequired] = useState(true);
  const [visibility, setVisibility] = useState<"shared" | "assigned">("shared");
  const [participantId, setParticipantId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ serialized: string; key: string } | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      title: title.trim(),
      description: description.trim(),
      stage,
      required,
      visibility,
      assigneeParticipantId: participantId || null,
      dueAt: dueDate(dueAt),
    };
    const serialized = JSON.stringify(body);
    if (operation.current?.serialized !== serialized)
      operation.current = { serialized, key: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      await mutate("", { ...body, idempotencyKey: operation.current.key }, "POST");
      onCreated();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>Add a task</h3>
        </CardTitle>
        <CardDescription>
          Manual requests stay on the application when product requirements change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={create}>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Task not saved</AlertTitle>
              <AlertDescription>
                {error} Your entries are still here; retry saving.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <label htmlFor="new-task-title" className="text-sm font-medium">
              Task title
            </label>
            <Input
              id="new-task-title"
              value={title}
              required
              maxLength={160}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="new-task-description" className="text-sm font-medium">
              Instructions
            </label>
            <textarea
              id="new-task-description"
              className={textareaClass}
              value={description}
              required
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="new-task-stage" className="text-sm font-medium">
                Stage
              </label>
              <NativeSelect
                id="new-task-stage"
                className="w-full"
                value={stage}
                disabled={busy}
                onChange={(event) => setStage(event.target.value as Stage)}
              >
                {Object.entries(stageLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label htmlFor="new-task-visibility" className="text-sm font-medium">
                Who can see it
              </label>
              <NativeSelect
                id="new-task-visibility"
                className="w-full"
                value={visibility}
                disabled={busy}
                onChange={(event) => setVisibility(event.target.value as "shared" | "assigned")}
              >
                <option value="shared">Application administrators and assignee</option>
                <option value="assigned">Assignee and bank staff</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label htmlFor="new-task-assignee" className="text-sm font-medium">
                Assigned participant
              </label>
              <NativeSelect
                id="new-task-assignee"
                className="w-full"
                value={participantId}
                disabled={busy}
                onChange={(event) => setParticipantId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {data.assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {workflowName(person.displayName)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label htmlFor="new-task-due" className="text-sm font-medium">
                Due date (optional)
              </label>
              <Input
                id="new-task-due"
                type="date"
                value={dueAt}
                disabled={busy}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-info"
              checked={required}
              disabled={busy}
              onChange={(event) => setRequired(event.target.checked)}
            />
            Required at this stage
          </label>
          <Button
            loading={busy}
            type="submit"
            disabled={busy || !title.trim() || !description.trim()}
          >
            Create task
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
