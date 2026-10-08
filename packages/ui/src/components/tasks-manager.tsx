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
import {
  SecureTaskInput,
  type SecureTaskInputData,
  type TaskInputKind,
} from "@keycade/ui/components/secure-task-input";
import { textareaClassName } from "@keycade/ui/components/textarea";
import { cn } from "cn";
import {
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleMinus,
  Clock3,
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
  const visible = data.tasks.filter(
    (task) => filter === "all" || task.state !== "cancelled" || task.id === selected,
  );
  const staffView = borrowerBusinessName === undefined;
  if (!staffView) {
    const priority: Record<State, number> = {
      needs_changes: 0,
      open: 1,
      submitted: 2,
      completed: 3,
      waived: 3,
      cancelled: 4,
    };
    const stages: Record<Stage, number> = { submission: 0, approval: 1, closing: 2 };
    visible.sort(
      (a, b) => priority[a.state] - priority[b.state] || stages[a.stage] - stages[b.stage],
    );
  }
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
  const requiredPercent =
    data.progress.required > 0
      ? Math.round((data.progress.requiredCompleted / data.progress.required) * 100)
      : 0;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-4 border-b px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>
              <h2 className="text-lg">Tasks</h2>
            </CardTitle>
            <CardDescription>Complete your checklist, one task at a time.</CardDescription>
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
                {data.progress.requiredCompleted} of {data.progress.required}
              </span>{" "}
              required tasks satisfied
            </p>
            <span
              aria-hidden="true"
              className="block h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-success transition-[width] duration-500"
                style={{ width: `${requiredPercent}%` }}
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
      </CardHeader>
      <CardContent className="space-y-7 px-5 py-5 sm:px-6">
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
              <section key={group.title} className="space-y-3" aria-label={group.title}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {
                      group.tasks.filter(
                        (task) => task.state === "completed" || task.state === "waived",
                      ).length
                    }
                    /{group.tasks.filter((task) => task.state !== "cancelled").length} complete
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.tasks.map((task) => {
                    const expanded = selected === task.id;
                    const actionable =
                      task.state === "open" &&
                      (task.canEdit || task.canSubmit || Boolean(task.secureInput?.canEdit));
                    const tone =
                      task.state === "completed" || task.state === "waived"
                        ? "success"
                        : task.state === "submitted"
                          ? "info"
                          : task.state === "needs_changes"
                            ? "warning"
                            : task.state === "cancelled"
                              ? "muted"
                              : actionable || staffView
                                ? "brand"
                                : "muted";
                    const StatusIcon =
                      task.state === "completed" || task.state === "waived"
                        ? CircleCheck
                        : task.state === "submitted"
                          ? Clock3
                          : task.state === "needs_changes"
                            ? CircleAlert
                            : task.state === "cancelled"
                              ? CircleMinus
                              : actionable
                                ? CircleDot
                                : Circle;
                    return (
                      <li
                        key={task.id}
                        className={cn(
                          "overflow-hidden rounded-xl border bg-card transition-colors",
                          expanded ? "border-brand/35 shadow-sm" : "hover:border-foreground/20",
                          task.state === "cancelled" && "bg-muted/40",
                        )}
                      >
                        <h4>
                          <button
                            type="button"
                            id={`task-toggle-${task.id}`}
                            aria-label={task.title}
                            aria-expanded={expanded}
                            aria-controls={`task-detail-${task.id}`}
                            aria-describedby={`task-status-${task.id}`}
                            disabled={busy}
                            onClick={() => selectTask(expanded ? null : task.id)}
                            className={cn(
                              "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 sm:px-5",
                              expanded && "bg-muted/40",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-full",
                                tone === "success" && "bg-success-soft text-success",
                                tone === "info" && "bg-info-soft text-info",
                                tone === "warning" && "bg-warning-soft text-warning",
                                tone === "brand" && "bg-brand-soft text-brand",
                                tone === "muted" && "bg-muted text-muted-foreground",
                              )}
                            >
                              <StatusIcon className="size-[1.125rem]" />
                            </span>
                            <span className="min-w-0 flex-1 space-y-1">
                              <span
                                className={cn(
                                  "block break-words text-sm leading-5 font-medium",
                                  task.state === "cancelled" && "text-muted-foreground",
                                )}
                              >
                                {task.title}
                              </span>
                              <span
                                id={`task-status-${task.id}`}
                                className="block text-xs leading-5 text-muted-foreground"
                              >
                                <span
                                  className={cn(
                                    "font-medium",
                                    tone === "success" && "text-success",
                                    tone === "info" && "text-info",
                                    tone === "warning" && "text-warning",
                                    tone === "brand" && "text-brand",
                                  )}
                                >
                                  {!staffView && task.state === "open"
                                    ? task.canEdit || task.canSubmit || task.secureInput?.canEdit
                                      ? "Needs your action"
                                      : task.inputKind === "signature"
                                        ? "Signature request"
                                        : "Waiting for assignee"
                                    : !staffView && task.state === "submitted"
                                      ? "Submitted / Waiting for lender review"
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
                          </button>
                        </h4>
                        {expanded && (
                          <div
                            id={`task-detail-${task.id}`}
                            role="region"
                            aria-labelledby={`task-toggle-${task.id}`}
                            className="border-t pb-1"
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
                            {detail?.id === task.id && (
                              <>
                                <TaskDetail
                                  key={`${detail.id}:${reloadCount}`}
                                  task={detail}
                                  signatureHref={signatureHref}
                                  data={data}
                                  busy={busy}
                                  // List refreshes can observe our write before mutate returns
                                  // its detail. Compare only after that write has settled;
                                  // an older list snapshot never makes the editor stale.
                                  stale={!busy && task.revision > detail.revision}
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
                                {renderDocuments &&
                                  ["answer", "signature"].includes(task.inputKind ?? "answer") && (
                                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                                      {renderDocuments(task.id, setUploading, task.visibility)}
                                    </div>
                                  )}
                              </>
                            )}
                          </div>
                        )}
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
        <p className="border-t pt-4 text-xs leading-5 text-muted-foreground">
          Simulated requirements · Use fictional information only. Saving answers does not submit or
          approve this application.
        </p>
      </CardContent>
    </Card>
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
    }
  }
  return (
    <div className="space-y-5 p-4 sm:p-5">
      {task.inputKind !== "tax_authorization" && (
        <p className="text-sm leading-6 text-foreground/90">{task.description}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {task.source === "manual" ? "Staff requested" : "Product requirement"} ·{" "}
        {task.required ? "Required" : "Optional"} · {assigneeName}
        {task.visibility === "private" && " · Owner private"}
      </p>
      <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
        <p className="font-medium">Why this applies</p>
        <p className="mt-1 leading-6 text-muted-foreground">{task.reason}</p>
      </div>
      {task.dueAt && <p className="text-sm font-medium">Due {displayDate(task.dueAt)}</p>}
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
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {task.reviews.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warning/25 bg-warning-soft/60 p-4">
          <h4 className="text-sm font-semibold">Bank review</h4>
          {task.reviews.slice(0, 1).map((review) => (
            <div key={review.id} className="text-sm">
              <p>
                {stateLabels[review.decision]} · {displayDate(review.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                {review.reason}
              </p>
            </div>
          ))}
        </div>
      )}
      {task.inputKind === "signature" ? (
        <div className="space-y-3 text-sm">
          <p>
            This task is managed by a simulated signature request. All intended signers must sign
            its current document before it can be completed.
          </p>
          {signatureHref && (
            <a
              className="font-medium underline underline-offset-4"
              href={signatureHref(task.signatureEnvelopeId ?? null)}
            >
              View simulated signature request
            </a>
          )}
        </div>
      ) : (task.inputKind ?? "answer") !== "answer" ? (
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
              disabled={busy || stale || secureDirty || task.evidenceRevision === 0}
              onClick={() =>
                void save("submit", {}, "POST", "Private task evidence submitted for bank review.")
              }
            >
              Submit for review
            </Button>
          )}
        </div>
      ) : (
        <form
          className="space-y-3 rounded-lg border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              "answer",
              { answer: answer.trim() },
              "PATCH",
              "Answer saved. Submit it when you are ready for bank review.",
            );
          }}
        >
          <label htmlFor={`answer-${task.id}`} className="block text-sm font-medium">
            Your answer
          </label>
          {task.visibility === "private" || task.stableKey.startsWith("tax-document-readiness:") ? (
            <NativeSelect
              id={`answer-${task.id}`}
              className="w-full"
              required
              value={answer}
              disabled={busy || !task.canEdit}
              onChange={(event) => setAnswer(event.target.value)}
            >
              <option value="">Choose an answer</option>
              <option value="confirmed">
                I confirm readiness to provide fictional information
              </option>
              <option value="needs_help">I need help with this confirmation</option>
            </NativeSelect>
          ) : (
            <textarea
              id={`answer-${task.id}`}
              className={textareaClass}
              required
              maxLength={4000}
              value={answer}
              disabled={busy || !task.canEdit}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Use fictional details only. Do not enter real EINs, SSNs, or other identifiers. Saving
            an answer does not submit it or approve the task.
          </p>
          {task.canEdit && ["completed", "waived", "submitted"].includes(task.state) && (
            <p className="text-sm text-muted-foreground">
              Changing a saved answer reopens this task and requires a new submission and bank
              review.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {task.canEdit && (
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !answer.trim() || !dirty || stale}
              >
                {busy ? "Saving…" : "Save answer"}
              </Button>
            )}
            {task.canSubmit && (
              <Button
                type="button"
                disabled={busy || dirty || !task.answer || stale}
                onClick={() => void save("submit", {}, "POST", "Answer submitted for bank review.")}
              >
                Submit for review
              </Button>
            )}
          </div>
          {dirty && task.canSubmit && (
            <p className="text-sm text-muted-foreground">Save your answer before submitting it.</p>
          )}
          {!task.canEdit && !task.canSubmit && (
            <p className="text-sm text-muted-foreground">
              {task.state === "submitted"
                ? "This answer is waiting for bank review."
                : task.state === "cancelled"
                  ? "This requirement no longer applies. Its history is preserved."
                  : "Only the authorized assignee can answer and submit this task."}
            </p>
          )}
        </form>
      )}
      {data.canManage &&
        (task.inputKind ?? "answer") === "answer" &&
        !["completed", "waived", "cancelled"].includes(task.state) && (
          <form
            className="space-y-4 rounded-lg border bg-card p-4"
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
                        {person.displayName}
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
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h4 className="text-sm font-semibold">Review task</h4>
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
                      "Task completed after bank review.",
                    )
                  }
                >
                  Complete task
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
      <details className="group/history border-t pt-4">
        <summary className="disclosure flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown
            aria-hidden="true"
            className="size-4 -rotate-90 transition-transform group-open/history:rotate-0"
          />
          Task history
        </summary>
        <div className="mt-3 space-y-4 text-sm">
          <p className="text-muted-foreground">
            Occurrence {task.occurrence} · Record revision {task.revision} · Answer revision{" "}
            {task.evidenceRevision}
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
        </div>
      </details>
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
    <Card className="bg-muted/30 shadow-none">
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
                    {person.displayName}
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
              className="size-4 accent-primary"
              checked={required}
              disabled={busy}
              onChange={(event) => setRequired(event.target.checked)}
            />
            Required at this stage
          </label>
          <Button type="submit" disabled={busy || !title.trim() || !description.trim()}>
            {busy ? "Adding…" : "Create task"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
