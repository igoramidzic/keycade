import {
  type StaffNote,
  type StaffOptions,
  type StaffWorkspace,
  staffOptionsSchema,
  staffWorkspaceSchema,
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
import { NativeSelect } from "@keycade/ui/components/native-select";
import { TaskProgress } from "@keycade/ui/components/tasks-manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ApiError, formatAmount, useStaffApi } from "./api";
import { ApplicationDocuments } from "./documents";
import { PrefillForm } from "./forms";
import { ApplicationParticipants } from "./participants";
import { ApplicationTasks } from "./tasks";
import {
  ErrorNotice,
  Field,
  Loading,
  SetupBadge,
  statusLabels,
  stepLabels,
  textareaClass,
} from "./ui";

const tabs = {
  overview: "Overview",
  participants: "Participants",
  tasks: "Tasks",
  documents: "Documents",
  checks: "Checks",
  notes: "Internal notes",
};
export function ApplicationDetail() {
  const api = useStaffApi();
  const client = useQueryClient();
  const params = useParams();
  const id = params.applicationId;
  const selected = params["*"] || "overview";
  const location = useLocation();
  const bank = new URLSearchParams(location.search).get("bank");
  const bankQuery = bank ? `?bank=${encodeURIComponent(bank)}` : "";
  const key = ["staff-workspace", id];
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api.request(`/applications/${id}/workspace`, staffWorkspaceSchema, { signal }),
  });
  const options = useQuery({
    queryKey: ["staff-options"],
    queryFn: ({ signal }) => api.request("/options", staffOptionsSchema, { signal }),
  });
  const [prefill, setPrefill] = useState(false);
  async function reload() {
    const result = await detail.refetch({ throwOnError: true });
    if (!result.data) throw new Error("Application unavailable.");
    return result.data;
  }
  async function mutation(path: string, body: object, method: "POST" | "PATCH") {
    await client.cancelQueries({ queryKey: key });
    const updated = await api.request(`/applications/${id}${path}`, staffWorkspaceSchema, {
      method,
      body,
    });
    client.setQueryData(key, updated);
    await client.invalidateQueries({ queryKey: ["staff-queue"] });
    return updated;
  }
  const data = detail.data;
  return (
    <div className="space-y-6">
      <Link to={`/${bankQuery}`} className="text-sm underline underline-offset-4">
        Back to applications
      </Link>
      {detail.isPending ? (
        <Loading>Loading application…</Loading>
      ) : detail.error && !data ? (
        <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        data && (
          <>
            {detail.error && (
              <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />
            )}
            {Boolean((location.state as { created?: boolean } | null)?.created) && (
              <Alert>
                <AlertTitle>Draft created</AlertTitle>
                <AlertDescription>
                  A continuation email is queued for the local inbox. The borrower must confirm the
                  prefilled answers and finish setup.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 space-y-3">
                <h1 className="break-words text-3xl font-semibold tracking-tight">
                  {data.businessName ?? "Untitled application"}
                </h1>
                <p className="break-all text-sm text-muted-foreground">Application {data.id}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{statusLabels[data.status]}</Badge>
                  <SetupBadge status={data.setup.status} />
                  <Badge variant="outline">
                    {data.source === "staff"
                      ? "Staff created"
                      : data.source === "borrower"
                        ? "Borrower created"
                        : "Synthetic fixture"}
                  </Badge>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xl font-medium">{formatAmount(data.requestedAmount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.productName ?? "Product not provided"}
                </p>
              </div>
            </div>
            <nav aria-label="Application sections" className="flex flex-wrap gap-2">
              {Object.entries(tabs).map(([value, label]) => (
                <Link
                  key={value}
                  to={`/applications/${data.id}/${value}${bankQuery}`}
                  aria-current={selected === value ? "page" : undefined}
                  className={`${buttonVariants({ variant: "ghost", size: "sm" })} ${selected === value ? "bg-card shadow-sm hover:bg-card" : "text-muted-foreground"}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {selected === "overview" && (
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card className="shadow-sm ring-0">
                    <CardHeader>
                      <CardTitle>Application overview</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-4 text-sm">
                        <Item label="Business name">{data.businessName ?? "Not provided"}</Item>
                        <Item label="Purpose">{data.purpose ?? "Not provided"}</Item>
                        <Item label="Industry">
                          {data.industryCode
                            ? `${data.industryCode} · ${data.industryTaxonomyVersion}`
                            : "Not provided"}
                        </Item>
                        <Item label="Created by">
                          {data.createdBy
                            ? `${data.createdBy.displayName} (${data.createdBy.email})`
                            : "Not recorded"}
                        </Item>
                        <Item label="Created">{new Date(data.createdAt).toLocaleString()}</Item>
                        <Item label="Last updated">
                          {new Date(data.updatedAt).toLocaleString()}
                        </Item>
                      </dl>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm ring-0">
                    <CardHeader>
                      <CardTitle>Borrower and setup</CardTitle>
                      <CardDescription>
                        Saved server progress, including unfinished drafts.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <Contact workspace={data} />
                      <dl className="space-y-4 text-sm">
                        <Item label="Saved setup step">
                          {data.setup.status === "completed"
                            ? "Completed"
                            : stepLabels[data.setup.currentStep]}
                        </Item>
                        <Item label="Confirmed questions">
                          {data.setup.completedSteps
                            .filter((step) => step !== "product")
                            .map((step) => stepLabels[step])
                            .join(", ") || "None yet"}
                        </Item>
                        <Item label="Skipped questions">
                          {data.setup.skippedSteps.map((step) => stepLabels[step]).join(", ") ||
                            "None"}
                        </Item>
                        {data.setup.completedAt && (
                          <Item label="Setup completed">
                            {new Date(data.setup.completedAt).toLocaleString()}
                          </Item>
                        )}
                      </dl>
                      {data.setup.status === "in_progress" && (
                        <Button variant="outline" onClick={() => setPrefill(true)}>
                          Edit prefilled answers
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
                <Card className="shadow-sm ring-0">
                  <CardHeader>
                    <CardTitle>Task progress</CardTitle>
                    <CardDescription>Current requirements for this application.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <TaskProgress progress={data.tasks} />
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      to={`/applications/${data.id}/tasks${bankQuery}`}
                    >
                      View tasks
                    </Link>
                  </CardContent>
                </Card>
                {prefill && data.setup.status === "in_progress" && (
                  <PrefillForm
                    key={data.id}
                    workspace={data}
                    onReload={reload}
                    onSaved={async () => {
                      await reload();
                      await client.invalidateQueries({ queryKey: ["staff-queue"] });
                    }}
                    onCancel={() => setPrefill(false)}
                  />
                )}
                {options.error ? (
                  <ErrorNotice error={options.error} onRetry={() => void options.refetch()} />
                ) : (
                  options.data && (
                    <Assignment
                      key={data.id}
                      workspace={data}
                      options={options.data}
                      save={(body) => mutation("/assignment", body, "PATCH")}
                      reload={reload}
                    />
                  )
                )}
              </div>
            )}
            {selected === "participants" && (
              <ApplicationParticipants key={data.id} applicationId={data.id} />
            )}
            {selected === "tasks" && <ApplicationTasks key={data.id} applicationId={data.id} />}
            {selected === "documents" && (
              <ApplicationDocuments key={data.id} applicationId={data.id} />
            )}
            {selected === "checks" && (
              <Card className="shadow-sm ring-0">
                <CardHeader>
                  <CardTitle>{tabs[selected]} are not available yet</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Simulated identity, business, and fraud checks will appear here when checks are
                    available. No checks have been run or passed.
                  </p>
                </CardContent>
              </Card>
            )}
            {selected === "notes" && (
              <Notes key={data.id} workspace={data} mutate={mutation} reload={reload} />
            )}
            {!Object.hasOwn(tabs, selected) && (
              <p role="alert">This application section does not exist. Select a section above.</p>
            )}
          </>
        )
      )}
    </div>
  );
}
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}
function Contact({ workspace }: { workspace: StaffWorkspace }) {
  return (
    <div className="space-y-2">
      <p className="break-all text-sm">
        {workspace.contact?.email ?? "Borrower contact not provided"}
      </p>
      {workspace.contact && (
        <Badge variant="outline">
          {workspace.contact.status === "pending"
            ? "Pending borrower"
            : workspace.contact.status === "verified"
              ? "Email verified"
              : "Email unverified"}
        </Badge>
      )}
      {workspace.contact?.status === "pending" && (
        <p className="text-sm text-muted-foreground">
          The borrower has not claimed this application yet.
        </p>
      )}
    </div>
  );
}
function Assignment({
  workspace,
  options,
  save,
  reload,
}: {
  workspace: StaffWorkspace;
  options: StaffOptions;
  save: (body: object) => Promise<StaffWorkspace>;
  reload: () => Promise<StaffWorkspace>;
}) {
  const [value, setValue] = useState(workspace.assignedStaffId ?? "");
  const [baseRevision, setBaseRevision] = useState(workspace.revision);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setValue(workspace.assignedStaffId ?? "");
      setBaseRevision(workspace.revision);
    }
  }, [dirty, workspace.assignedStaffId, workspace.revision]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="shadow-sm ring-0">
      <CardHeader>
        <CardTitle>Staff assignment</CardTitle>
        <CardDescription>
          All active officers can access bank applications. Assignment identifies the coordinating
          officer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setSaved(false);
            setError(null);
            try {
              const updated = await save({
                expectedRevision: baseRevision,
                assignedStaffId: value || null,
              });
              setValue(updated.assignedStaffId ?? "");
              setBaseRevision(updated.revision);
              setDirty(false);
              setSaved(true);
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="assigned-officer" label="Assigned officer">
            <NativeSelect
              id="assigned-officer"
              className="w-full sm:max-w-sm"
              value={value}
              disabled={busy}
              onChange={(event) => {
                setValue(event.target.value);
                setDirty(true);
                setSaved(false);
              }}
            >
              <option value="">Unassigned</option>
              {workspace.assignedStaffId &&
                !options.officers.some((officer) => officer.id === workspace.assignedStaffId) && (
                  <option value={workspace.assignedStaffId} disabled>
                    {workspace.assignedStaffName ?? "Inactive officer"}
                  </option>
                )}
              {options.officers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.displayName}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {Boolean(error) && <ErrorNotice error={error} />}
          <ConflictReload
            error={error}
            reload={async () => {
              const latest = await reload();
              setValue(latest.assignedStaffId ?? "");
              setBaseRevision(latest.revision);
              setDirty(false);
            }}
            clear={() => setError(null)}
          />
          {saved && (
            <p role="status" className="text-sm">
              Assignment saved.
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save assignment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
function ConflictReload({
  error,
  reload,
  clear,
}: {
  error: unknown;
  reload: () => Promise<void>;
  clear: () => void;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  return (
    <>
      {Boolean(failure) && <ErrorNotice error={failure} />}
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await reload();
            setFailure(null);
            clear();
          } catch (nextError) {
            setFailure(nextError);
          }
        }}
      >
        Reload saved record and replace edits
      </Button>
    </>
  );
}
function Notes({
  workspace,
  mutate,
  reload,
}: {
  workspace: StaffWorkspace;
  mutate: (path: string, body: object, method: "POST" | "PATCH") => Promise<StaffWorkspace>;
  reload: () => Promise<StaffWorkspace>;
}) {
  const [body, setBody] = useState("");
  const [baseRevision, setBaseRevision] = useState(workspace.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await mutate("/notes", { expectedRevision: baseRevision, body }, "POST");
      setBaseRevision(updated.revision);
      setBody("");
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Card className="shadow-sm ring-0">
        <CardHeader>
          <CardTitle>Internal notes</CardTitle>
          <CardDescription>
            Visible only to authorized bank staff. Never shown in the borrower portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <Field id="new-note" label="New internal note">
              <textarea
                id="new-note"
                className={textareaClass}
                required
                maxLength={5000}
                value={body}
                disabled={busy}
                onChange={(event) => {
                  if (!body) setBaseRevision(workspace.revision);
                  setBody(event.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            {Boolean(error) && <ErrorNotice error={error} />}
            <ConflictReload
              error={error}
              reload={async () => {
                const latest = await reload();
                setBody("");
                setBaseRevision(latest.revision);
              }}
              clear={() => setError(null)}
            />
            {saved && (
              <p role="status" className="text-sm">
                Internal note added.
              </p>
            )}
            <Button type="submit" disabled={busy || !body.trim()}>
              {busy ? "Saving…" : "Add note"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {workspace.notes.length ? (
        workspace.notes.map((note) => (
          <Card key={note.id} className="shadow-sm ring-0">
            <CardHeader>
              <CardTitle>{note.author.displayName}</CardTitle>
              <CardDescription>
                Added {new Date(note.createdAt).toLocaleString()}
                {note.updatedAt !== note.createdAt
                  ? ` · Edited by ${note.updatedBy.displayName} ${new Date(note.updatedAt).toLocaleString()}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing === note.id ? (
                <EditNote
                  note={note}
                  revision={workspace.revision}
                  reload={reload}
                  save={(body) => mutate(`/notes/${note.id}`, body, "PATCH")}
                  close={() => setEditing(null)}
                />
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{note.body}</p>
                  <Button variant="outline" size="sm" onClick={() => setEditing(note.id)}>
                    Edit note
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No internal notes yet.</p>
      )}
    </div>
  );
}
function EditNote({
  note,
  revision,
  reload,
  save,
  close,
}: {
  note: StaffNote;
  revision: number;
  reload: () => Promise<StaffWorkspace>;
  save: (body: object) => Promise<StaffWorkspace>;
  close: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await save({ expectedRevision: baseRevision, body });
          close();
        } catch (error) {
          setError(error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id={`edit-note-${note.id}`} label="Edit internal note">
        <textarea
          id={`edit-note-${note.id}`}
          className={textareaClass}
          required
          maxLength={5000}
          value={body}
          disabled={busy}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      {Boolean(error) && <ErrorNotice error={error} />}
      <ConflictReload
        error={error}
        reload={async () => {
          const latest = await reload();
          const latestNote = latest.notes.find((item) => item.id === note.id);
          if (!latestNote) throw new Error("This note is unavailable.");
          setBody(latestNote.body);
          setBaseRevision(latest.revision);
        }}
        clear={() => setError(null)}
      />
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !body.trim()}>
          {busy ? "Saving…" : "Save note"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
