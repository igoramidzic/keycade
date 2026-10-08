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
import { useDemoKit } from "@keycade/ui/components/demo-kit";
import {
  categoryLabels,
  type DocumentCategory,
  DocumentInterpretation,
  type DocumentProcessingData,
} from "@keycade/ui/components/document-interpretation";
import { NativeSelect } from "@keycade/ui/components/native-select";
import {
  createDemoDocumentFile,
  demoDocumentMime,
  readDemoDocumentDrag,
} from "@keycade/ui/lib/demo-document-transfer";
import { FileUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type DocumentVersionData = {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadState: "staged" | "uploaded" | "abandoned" | "missing";
  scanState: "pending" | "clean" | "blocked" | "error";
  canDownload: boolean;
  canRetryScan: boolean;
  createdAt: string;
  processing?: DocumentProcessingData | null;
};
const categoryKeys = Object.keys(categoryLabels) as DocumentCategory[];
export type DocumentData = {
  id: string;
  taskId: string | null;
  visibility: "shared" | "assigned" | "private";
  currentVersionId: string | null;
  versions: DocumentVersionData[];
  canReplace: boolean;
  category?: DocumentCategory;
};
export type DocumentsData = {
  applicationId: string;
  canUpload: boolean;
  uploadTasks: { id: string; title: string }[];
  limits: { maxFileBytes: number; maxBatchFiles: number; allowedMimeTypes: string[] };
  documents: DocumentData[];
};
export type UploadInput = {
  fileName: string;
  mimeType: string;
  expectedSize: number;
  idempotencyKey: string;
  taskId?: string;
  replacesDocumentId?: string;
};
export type UploadResult = { idempotencyKey: string } & (
  | { uploadId: string; alreadyFinalized: boolean }
  | { error: string }
);
type QueueFile = {
  id: string;
  file: File;
  input: UploadInput;
  state: "preparing" | "uploading" | "complete" | "error" | "cancelled";
  percent: number;
  error?: string;
};
const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KiB`;
function status(version: DocumentVersionData) {
  if (version.uploadState === "missing") return "File unavailable";
  if (version.uploadState === "abandoned") return "Upload cancelled";
  if (version.uploadState === "staged") return "Upload unfinished";
  return {
    pending: "Simulated scan pending",
    clean: "Simulated scan clean",
    blocked: "Blocked by simulated scan",
    error: "Simulated scan failed",
  }[version.scanState];
}

export function DocumentsManager({
  data,
  begin,
  upload,
  cancel,
  download,
  retryScan,
  retryProcessing,
  correctCategory,
  reload,
  errorMessage,
  taskId,
  taskVisibility,
  onBusyChange,
  active = true,
}: {
  data: DocumentsData;
  begin: (files: UploadInput[]) => Promise<{ uploads: UploadResult[] }>;
  upload: (
    uploadId: string,
    file: File,
    progress: (value: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  cancel: (uploadId: string) => Promise<unknown>;
  download: (versionId: string, fileName: string) => Promise<void>;
  retryScan: (versionId: string) => Promise<unknown>;
  retryProcessing: (versionId: string) => Promise<unknown>;
  correctCategory: (
    documentId: string,
    versionId: string,
    category: DocumentCategory,
    reason: string,
  ) => Promise<unknown>;
  reload: () => Promise<unknown>;
  errorMessage: (error: unknown) => string;
  taskId?: string;
  taskVisibility?: "shared" | "assigned" | "private";
  onBusyChange?: (busy: boolean) => void;
  active?: boolean;
}) {
  const pickerId = useId();
  const demoKit = useDemoKit();
  const picker = useRef<HTMLInputElement>(null);
  const controls = useRef(new Map<string, { controller: AbortController; uploadId?: string }>());
  const mounted = useRef(true);
  const [queue, setQueue] = useState<QueueFile[]>([]);
  const [selectedTask, setSelectedTask] = useState(taskId ?? "");
  const [replacement, setReplacement] = useState<DocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | DocumentCategory>("all");
  const busy = queue.some((entry) => entry.state === "preparing" || entry.state === "uploading");
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const entry of controls.current.values()) entry.controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);
  const documents = taskId
    ? data.documents.filter((document) => document.taskId === taskId)
    : data.documents;
  const filteredDocuments =
    category === "all"
      ? documents
      : documents.filter((document) => (document.category ?? "other") === category);
  const categories = ["all", ...categoryKeys] as const;
  const canUpload = taskId
    ? data.uploadTasks.some((task) => task.id === taskId)
    : data.canUpload || data.uploadTasks.length > 0;
  const uploadTask = taskId ?? selectedTask;
  const validTask = !uploadTask
    ? data.canUpload
    : data.uploadTasks.some((task) => task.id === uploadTask);
  const demoSubject = taskId && taskVisibility === "private" ? "guarantor" : "business";
  const demoUpload = useRef<(document: Parameters<typeof createDemoDocumentFile>[0]) => void>(
    () => undefined,
  );
  demoUpload.current = (document) => {
    if (!active) return;
    if (demoKit && !demoKit.uploadsEnabled) return;
    if (document.subject !== demoSubject) {
      setError(
        document.subject === "guarantor"
          ? "Open the guarantor’s private task to upload this personal demo document."
          : "Open application Documents or a business task to upload this business demo document.",
      );
      return;
    }
    addFiles([
      createDemoDocumentFile(document, demoKit?.businessName ?? "Synthetic Cedar Workshop"),
    ]);
  };
  const registerDemoUpload = demoKit?.registerUploadTarget;
  const demoUploadsEnabled = demoKit?.uploadsEnabled ?? true;
  const demoTargetTitle = data.uploadTasks.find((task) => task.id === uploadTask)?.title;
  useEffect(() => {
    if (!active || !registerDemoUpload || !demoUploadsEnabled || !canUpload || !validTask) return;
    return registerDemoUpload({
      id: `${data.applicationId}:${uploadTask || "application"}`,
      label: demoTargetTitle ?? "Application documents",
      subject: demoSubject,
      priority: uploadTask ? 1 : 0,
      upload: (document) => demoUpload.current(document),
    });
  }, [
    active,
    registerDemoUpload,
    demoUploadsEnabled,
    canUpload,
    validTask,
    data.applicationId,
    uploadTask,
    demoTargetTitle,
    demoSubject,
  ]);
  function update(id: string, changes: Partial<QueueFile>) {
    if (mounted.current)
      setQueue((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
      );
  }
  async function send(entries: QueueFile[]) {
    for (const entry of entries)
      controls.current.set(entry.id, { controller: new AbortController() });
    try {
      const result = await begin(entries.map((entry) => entry.input));
      await Promise.all(
        entries.map(async (entry) => {
          const control = controls.current.get(entry.id);
          const initialized = result.uploads.find(
            (item) => item.idempotencyKey === entry.input.idempotencyKey,
          );
          if (!control) return;
          if (!initialized || "error" in initialized) {
            update(entry.id, {
              state: control.controller.signal.aborted ? "cancelled" : "error",
              error:
                initialized && "error" in initialized
                  ? initialized.error
                  : "We couldn’t prepare this upload. Retry this file.",
            });
            controls.current.delete(entry.id);
            return;
          }
          control.uploadId = initialized.uploadId;
          try {
            if (control.controller.signal.aborted && !initialized.alreadyFinalized) {
              await cancel(initialized.uploadId);
              update(entry.id, { state: "cancelled" });
            } else {
              if (!initialized.alreadyFinalized) {
                update(entry.id, { state: "uploading" });
                await upload(
                  initialized.uploadId,
                  entry.file,
                  (percent) => update(entry.id, { percent }),
                  control.controller.signal,
                );
              }
              update(entry.id, { state: "complete", percent: 100 });
            }
          } catch (failure) {
            update(entry.id, {
              state: control.controller.signal.aborted ? "cancelled" : "error",
              error: errorMessage(failure),
            });
          } finally {
            controls.current.delete(entry.id);
          }
        }),
      );
    } catch (failure) {
      for (const entry of entries) {
        const aborted = controls.current.get(entry.id)?.controller.signal.aborted;
        update(entry.id, { state: aborted ? "cancelled" : "error", error: errorMessage(failure) });
        controls.current.delete(entry.id);
      }
    } finally {
      if (mounted.current) await reload().catch(() => undefined);
    }
  }
  function addFiles(files: File[]) {
    setDragging(false);
    setError(null);
    if (!canUpload || !files.length) return;
    if (!replacement && !validTask) {
      setError("Choose a task you can upload documents for.");
      return;
    }
    if (files.length > data.limits.maxBatchFiles) {
      setError(`Choose up to ${data.limits.maxBatchFiles} files at a time.`);
      return;
    }
    if (replacement && files.length !== 1) {
      setError("Choose one file for a replacement version.");
      return;
    }
    const entries: QueueFile[] = files.map((file) => {
      const reason = !data.limits.allowedMimeTypes.includes(file.type)
        ? "Choose a PDF, JPEG, or PNG file."
        : file.size > data.limits.maxFileBytes
          ? `This file exceeds the ${fileSize(data.limits.maxFileBytes)} limit.`
          : file.size === 0
            ? "This file is empty."
            : undefined;
      const linkedTask = replacement?.taskId ?? uploadTask;
      return {
        id: crypto.randomUUID(),
        file,
        percent: 0,
        state: reason ? "error" : "preparing",
        error: reason,
        input: {
          fileName: file.name,
          mimeType: file.type,
          expectedSize: file.size,
          idempotencyKey: crypto.randomUUID(),
          ...(linkedTask ? { taskId: linkedTask } : {}),
          ...(replacement ? { replacesDocumentId: replacement.id } : {}),
        },
      };
    });
    setQueue((current) => [...current, ...entries]);
    setReplacement(null);
    const valid = entries.filter((entry) => entry.state === "preparing");
    if (valid.length) void send(valid);
  }
  async function cancelFile(entry: QueueFile) {
    const control = controls.current.get(entry.id);
    if (!control) return;
    control.controller.abort();
    update(entry.id, { state: "cancelled" });
    if (control.uploadId) {
      try {
        await cancel(control.uploadId);
        await reload();
      } catch (failure) {
        setError(
          `${errorMessage(failure)} Refresh the list to confirm whether the upload finished.`,
        );
      }
    }
  }
  async function perform(key: string, operation: () => Promise<unknown>) {
    setError(null);
    setAction(key);
    try {
      await operation();
      await reload();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setAction(null);
    }
  }
  return (
    <Card className={taskId ? "border-0 bg-transparent ring-0 shadow-none" : undefined}>
      <CardHeader>
        <CardTitle>
          <h2>{taskId ? "Task documents" : "Documents"}</h2>
        </CardTitle>
        <CardDescription>
          Use synthetic documents only. Files stay private and quarantined until their simulated
          scan is clean.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Document action incomplete</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {canUpload && (
          <div className="space-y-3">
            {!taskId && (
              <div className="space-y-2">
                <label htmlFor={`${pickerId}-task`} className="text-sm font-medium">
                  Attach to
                </label>
                <NativeSelect
                  id={`${pickerId}-task`}
                  className="w-full"
                  value={selectedTask}
                  disabled={Boolean(replacement)}
                  onChange={(event) => setSelectedTask(event.target.value)}
                >
                  <option value="">
                    {data.canUpload ? "Application documents" : "Choose an assigned task"}
                  </option>
                  {data.uploadTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {replacement && (
              <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
                <span>Choose a replacement. Previous versions remain in history.</span>
                <Button size="sm" variant="ghost" onClick={() => setReplacement(null)}>
                  Cancel replacement
                </Button>
              </div>
            )}
            <section
              aria-label="Document upload drop area"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.types.includes(demoDocumentMime)) {
                  setDragging(false);
                  const sample = readDemoDocumentDrag(event.dataTransfer);
                  if (!sample) {
                    setError(
                      "This demo document is unavailable. Drag a PDF from the demo kit again.",
                    );
                    return;
                  }
                  demoUpload.current(sample.document);
                } else addFiles(Array.from(event.dataTransfer.files));
              }}
              className={`rounded-lg border-2 border-dashed p-5 text-center ${dragging ? "border-primary bg-muted" : "border-border"}`}
            >
              <FileUp className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" />
              <p className="mb-3 text-sm">Drop files here or choose files to upload</p>
              <input
                ref={picker}
                id={pickerId}
                aria-label="Choose document files"
                className="sr-only"
                tabIndex={-1}
                type="file"
                multiple={!replacement}
                accept={data.limits.allowedMimeTypes.join(",")}
                onChange={(event) => {
                  addFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!replacement && !validTask}
                onClick={() => picker.current?.click()}
              >
                Choose files
              </Button>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                PDF, JPEG, PNG · Up to {fileSize(data.limits.maxFileBytes)} per file ·{" "}
                {data.limits.maxBatchFiles} files per batch
              </p>
            </section>
            <p className="text-xs text-muted-foreground">
              Uploading task evidence reopens completed or submitted review. Keep this page open
              until uploads finish.
            </p>
          </div>
        )}
        {queue.length > 0 && (
          <section aria-label="Upload progress" className="space-y-3">
            <h3 className="text-sm font-medium">Uploads</h3>
            <ul className="space-y-3">
              {queue.map((entry) => (
                <li
                  key={entry.id}
                  className="space-y-2 rounded-lg border p-3"
                  aria-label={`Upload ${entry.file.name}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 break-all text-sm font-medium">{entry.file.name}</p>
                    <span className="text-xs text-muted-foreground">
                      {fileSize(entry.file.size)}
                    </span>
                  </div>
                  {(entry.state === "preparing" || entry.state === "uploading") && (
                    <progress
                      className="h-2 w-full"
                      aria-label={`Upload progress for ${entry.file.name}`}
                      max={100}
                      value={entry.percent}
                    />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      role={entry.state === "error" ? "alert" : "status"}
                      className="text-sm text-muted-foreground"
                    >
                      {entry.state === "complete"
                        ? "Uploaded. See the scan status below."
                        : entry.state === "cancelled"
                          ? "Upload cancelled."
                          : entry.state === "error"
                            ? entry.error
                            : entry.state === "preparing"
                              ? "Preparing upload…"
                              : `Uploading ${entry.percent}%`}
                    </p>
                    {entry.state === "preparing" || entry.state === "uploading" ? (
                      <Button size="sm" variant="ghost" onClick={() => void cancelFile(entry)}>
                        Cancel upload
                      </Button>
                    ) : (entry.state === "error" || entry.state === "cancelled") &&
                      data.limits.allowedMimeTypes.includes(entry.file.type) &&
                      entry.file.size > 0 &&
                      entry.file.size <= data.limits.maxFileBytes ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const retry = {
                            ...entry,
                            id: crypto.randomUUID(),
                            state: "preparing" as const,
                            percent: 0,
                            error: undefined,
                            input: {
                              ...entry.input,
                              idempotencyKey:
                                entry.state === "cancelled"
                                  ? crypto.randomUUID()
                                  : entry.input.idempotencyKey,
                            },
                          };
                          update(entry.id, retry);
                          void send([retry]);
                        }}
                      >
                        Retry upload
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Saved documents" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{taskId ? "Attached files" : "Saved documents"}</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(action)}
              onClick={() => void perform("refresh", reload)}
            >
              Refresh documents
            </Button>
          </div>
          <div
            role="tablist"
            aria-label="Document categories"
            className="flex flex-wrap gap-1 border-b pb-3"
          >
            {categories.map((key, index) => {
              const count =
                key === "all"
                  ? documents.length
                  : documents.filter((document) => (document.category ?? "other") === key).length;
              const label = key === "all" ? "All documents" : categoryLabels[key];
              return (
                <Button
                  key={key}
                  id={`${pickerId}-category-${key}`}
                  role="tab"
                  aria-selected={category === key}
                  aria-controls={`${pickerId}-document-list`}
                  tabIndex={category === key ? 0 : -1}
                  variant={category === key ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setCategory(key)}
                  onKeyDown={(event) => {
                    let next: number | undefined;
                    if (event.key === "ArrowRight") next = (index + 1) % categories.length;
                    else if (event.key === "ArrowLeft")
                      next = (index + categories.length - 1) % categories.length;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = categories.length - 1;
                    if (next === undefined) return;
                    event.preventDefault();
                    const value = categories[next];
                    if (value) {
                      setCategory(value);
                      globalThis.document.getElementById(`${pickerId}-category-${value}`)?.focus();
                    }
                  }}
                >
                  {label} <span className="text-muted-foreground">({count})</span>
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Categories and counts include only documents you can access. Suggested categories and
            fields are simulated.
          </p>
          <div
            role="tabpanel"
            id={`${pickerId}-document-list`}
            aria-labelledby={`${pickerId}-category-${category}`}
            tabIndex={0}
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {!documents.length ? (
              <p className="text-sm text-muted-foreground">
                No documents are visible for your account yet.
              </p>
            ) : !filteredDocuments.length ? (
              <p className="py-3 text-sm text-muted-foreground">
                No visible documents in this category.
              </p>
            ) : (
              <ul className="space-y-3">
                {filteredDocuments.map((document) => {
                  const current =
                    document.versions.find((version) => version.id === document.currentVersionId) ??
                    document.versions[0];
                  if (!current) return null;
                  const older = document.versions.filter((version) => version.id !== current.id);
                  const renderVersion = (version: DocumentVersionData) => (
                    <div className="space-y-2">
                      <p className="break-all text-sm font-medium">{version.fileName}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            version.scanState === "blocked" || version.uploadState === "missing"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {status(version)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Version {version.version} · {fileSize(version.sizeBytes)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {version.canDownload && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(action)}
                            onClick={() =>
                              void perform(version.id, () => download(version.id, version.fileName))
                            }
                          >
                            Download
                          </Button>
                        )}
                        {version.canRetryScan && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(action)}
                            onClick={() => void perform(version.id, () => retryScan(version.id))}
                          >
                            Retry simulated scan
                          </Button>
                        )}
                      </div>
                      {!version.canDownload && (
                        <p className="text-xs text-muted-foreground">
                          Download is unavailable until this file is present and its simulated scan
                          is clean.
                        </p>
                      )}
                      {version.processing && (
                        <DocumentInterpretation
                          processing={version.processing}
                          versionId={version.id}
                          retry={() => retryProcessing(version.id)}
                          correct={async (category, reason) => {
                            await correctCategory(document.id, version.id, category, reason);
                            setCategory("all");
                          }}
                          reload={reload}
                          errorMessage={errorMessage}
                        />
                      )}
                    </div>
                  );
                  return (
                    <li
                      key={document.id}
                      className="space-y-3 rounded-lg border p-4"
                      aria-label={`Document ${current.fileName}`}
                    >
                      {renderVersion(current)}
                      <p className="text-xs text-muted-foreground">
                        {document.visibility === "private"
                          ? "Owner private"
                          : document.visibility === "assigned"
                            ? "Assigned participants and bank staff"
                            : "Shared with permitted application participants"}
                        {document.taskId
                          ? ` · ${data.uploadTasks.find((task) => task.id === document.taskId)?.title ?? "Task evidence"}`
                          : " · Application document"}
                      </p>
                      {document.canReplace && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setReplacement(document);
                            picker.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                            picker.current?.click();
                          }}
                        >
                          Upload replacement
                        </Button>
                      )}
                      {older.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-sm">
                            Previous versions ({older.length})
                          </summary>
                          <ul className="mt-3 space-y-4">
                            {older.map((version) => (
                              <li className="border-l-2 pl-3" key={version.id}>
                                {renderVersion(version)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <p className="text-xs leading-5 text-muted-foreground">
          Simulated scanning is for this demo and is not a production malware scanner. Uploading a
          file does not verify its contents or approve your application.
        </p>
      </CardContent>
    </Card>
  );
}
