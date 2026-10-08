import {
  authSessionSchema,
  documentActionResultSchema,
  documentsViewSchema,
  documentUploadResultSchema,
} from "@keycade/contracts";
import type { DemoDocument } from "@keycade/contracts/demo-scenarios";
import { Button } from "@keycade/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@keycade/ui/components/card";
import { useDemoKit } from "@keycade/ui/components/demo-kit";
import type { UploadInput } from "@keycade/ui/components/documents-manager";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import {
  createDemoDocumentFile,
  demoDocumentMime,
  readDemoDocumentDrag,
} from "@keycade/ui/lib/demo-document-transfer";
import {
  createDemoImportFile,
  type DemoImportPreview,
  type DemoImportSource,
  demoImportMime,
  readDemoImportDrag,
  sameDemoImportContext,
} from "@keycade/ui/lib/demo-import-transfer";
import { createDocumentTransfer } from "@keycade/ui/lib/document-transfer";
import { documentRefreshInterval } from "@keycade/ui/lib/refresh-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError, errorMessage, request } from "./api";
import { generalUploadStatus, generalUploadVersions } from "./dashboard-upload-state";
import { ErrorNotice } from "./workspace-ui";

type Props = {
  session: AuthenticatedSession;
  applicationId: string;
  onAccessLost: (error: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
  documentsHref: string;
  active?: boolean;
};
type QueuedFile = {
  id: string;
  file: File;
  input: UploadInput;
  state: "preparing" | "uploading" | "complete" | "error";
  percent: number;
  retryable: boolean;
  versionId?: string;
  error?: string;
};
const accessLost = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);

/** A new application or actor always gets an empty, independent in-memory upload queue. */
export function DashboardUpload(props: Props) {
  return (
    <ApplicationUpload
      key={`${props.session.bank.id}:${props.session.user.email}:${props.applicationId}`}
      {...props}
    />
  );
}

function ApplicationUpload({
  session,
  applicationId,
  onAccessLost,
  onBusyChange,
  documentsHref,
  active = true,
}: Props) {
  const client = useQueryClient();
  const demoKit = useDemoKit();
  const pickerId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const denied = useRef(false);
  const controls = useRef(new Map<string, AbortController>());
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const base = `/api/v1/banks/${session.bank.id}/applications/${applicationId}/documents`;
  const options = { bankId: session.bank.id, actorEmail: session.user.email };
  const queryKey = ["documents", session.bank.id, session.user.email, applicationId];
  const documents = useQuery({
    queryKey,
    enabled: active,
    queryFn: ({ signal }) => request(base, documentsViewSchema, { ...options, signal }),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      !active || query.state.error ? false : documentRefreshInterval(query.state.data),
  });
  const currentAccessError = accessLost(documents.error)
    ? documents.error
    : accessLost(failure)
      ? failure
      : null;
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;
  useEffect(() => {
    if (!currentAccessError) return;
    denied.current = true;
    for (const controller of controls.current.values()) controller.abort();
    setQueue([]);
    if (picker.current) picker.current.value = "";
    onAccessLostRef.current(currentAccessError);
  }, [currentAccessError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controls.current.values()) controller.abort();
    };
  }, []);
  const busy = queue.some((entry) => entry.state === "preparing" || entry.state === "uploading");
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);
  const data = documents.data;
  const canUpload =
    !currentAccessError &&
    !documents.error &&
    documents.isFetchedAfterMount &&
    data?.canUpload === true;
  useEffect(() => {
    if (!documents.isFetchedAfterMount || data?.canUpload !== false) return;
    for (const controller of controls.current.values()) controller.abort();
    setQueue([]);
  }, [documents.isFetchedAfterMount, data?.canUpload]);
  async function guarded<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (mounted.current && accessLost(error)) {
        denied.current = true;
        setFailure(error);
        setQueue([]);
        for (const controller of controls.current.values()) controller.abort();
      }
      throw error;
    }
  }
  const transfer = createDocumentTransfer({
    base,
    verify: async (signal) => {
      const current = await request("/api/v1/auth/session", authSessionSchema, { signal });
      if (
        !current.authenticated ||
        current.bank.id !== session.bank.id ||
        current.user.email !== session.user.email
      )
        throw new ApiError("SESSION_CHANGED", 401, "Your sign-in changed. Please sign in again.");
      return current;
    },
    error: (code, status, detail) => new ApiError(code, status, detail),
  });
  async function reload() {
    const refreshed = await documents.refetch();
    if (refreshed.error) throw refreshed.error;
    await client.invalidateQueries({
      queryKey: ["portal", session.bank.id, session.user.email, applicationId],
    });
  }
  function update(id: string, changes: Partial<QueuedFile>) {
    if (mounted.current && !denied.current)
      setQueue((entries) =>
        entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
      );
  }
  async function send(entries: QueuedFile[]) {
    for (const entry of entries) controls.current.set(entry.id, new AbortController());
    try {
      const result = await guarded(() =>
        request(`${base}/uploads`, documentUploadResultSchema, {
          ...options,
          method: "POST",
          body: { files: entries.map((entry) => entry.input) },
        }),
      );
      await Promise.all(
        entries.map(async (entry) => {
          const controller = controls.current.get(entry.id);
          if (!controller || controller.signal.aborted) return;
          const reservation = result.uploads.find(
            (upload) => upload.idempotencyKey === entry.input.idempotencyKey,
          );
          if (!reservation || "error" in reservation) {
            update(entry.id, {
              state: "error",
              error:
                reservation && "error" in reservation
                  ? reservation.error
                  : "We couldn’t prepare this file. Retry the upload.",
            });
            controls.current.delete(entry.id);
            return;
          }
          update(entry.id, { state: "uploading", versionId: reservation.versionId });
          try {
            if (!reservation.alreadyFinalized)
              await guarded(() =>
                transfer.upload(
                  reservation.uploadId,
                  entry.file,
                  (percent) => update(entry.id, { percent }),
                  controller.signal,
                ),
              );
            update(entry.id, { state: "complete", percent: 100, error: undefined });
          } catch (error) {
            if (!controller.signal.aborted)
              update(entry.id, { state: "error", error: errorMessage(error) });
          } finally {
            controls.current.delete(entry.id);
          }
        }),
      );
    } catch (error) {
      for (const entry of entries) {
        update(entry.id, { state: "error", error: errorMessage(error) });
        controls.current.delete(entry.id);
      }
    } finally {
      if (mounted.current && !denied.current) await guarded(reload).catch(() => undefined);
    }
  }
  function addFiles(files: File[], demoImport?: DemoImportSource) {
    setDragging(false);
    setMessage(null);
    if (!canUpload || !data || !files.length) return;
    if (files.length > data.limits.maxBatchFiles) {
      setMessage(`Choose up to ${data.limits.maxBatchFiles} files at a time.`);
      return;
    }
    const entries: QueuedFile[] = files.map((file) => {
      const reason = !data.limits.allowedMimeTypes.includes(
        file.type as "application/pdf" | "image/jpeg" | "image/png",
      )
        ? "Choose a PDF, JPEG, or PNG file."
        : file.size > data.limits.maxFileBytes
          ? `This file exceeds the ${Math.round(data.limits.maxFileBytes / 1024 / 1024)} MiB limit.`
          : file.size === 0
            ? "This file is empty."
            : undefined;
      return {
        id: crypto.randomUUID(),
        file,
        state: reason ? "error" : "preparing",
        percent: 0,
        retryable: !reason,
        error: reason,
        input: {
          fileName: file.name,
          mimeType: file.type,
          expectedSize: file.size,
          idempotencyKey: crypto.randomUUID(),
          ...(demoImport ? { demoImport } : {}),
        },
      };
    });
    setQueue((current) => [...current, ...entries]);
    const valid = entries.filter((entry) => entry.state === "preparing");
    if (valid.length) void send(valid);
  }
  const demoUpload = useRef<(document: DemoDocument) => void>(() => undefined);
  demoUpload.current = (document) => {
    if (!active || !demoKit?.uploadsEnabled || !canUpload) return;
    if (document.subject !== "business") {
      setMessage("Open the corresponding private task to upload personal demo evidence.");
      return;
    }
    addFiles([createDemoDocumentFile(document, demoKit.businessName)]);
  };
  const demoImportUpload = useRef<(preview: DemoImportPreview) => void>(() => undefined);
  demoImportUpload.current = (preview) => {
    if (!active || !demoKit?.uploadsEnabled || !canUpload) return;
    if (!sameDemoImportContext(preview.fixture, data?.demoImportContext ?? undefined)) {
      setMessage("The application snapshot changed. Import the text file again before uploading.");
      return;
    }
    addFiles([createDemoImportFile(preview.fixture)], preview.source);
  };
  const registerDemoUpload = demoKit?.registerUploadTarget;
  const demoEnabled = demoKit?.uploadsEnabled;
  useEffect(() => {
    if (!active || !registerDemoUpload || !demoEnabled || !canUpload) return;
    return registerDemoUpload({
      id: `${applicationId}:dashboard`,
      label: "Other application documents",
      subject: "business",
      upload: (document) => demoUpload.current(document),
      demoImportContext: data?.demoImportContext ?? undefined,
      uploadImport: (preview) => demoImportUpload.current(preview),
    });
  }, [active, applicationId, registerDemoUpload, demoEnabled, canUpload, data?.demoImportContext]);
  async function retryVersion(versionId: string, kind: "scan" | "processing") {
    setAction(versionId);
    setMessage(null);
    try {
      await guarded(() =>
        request(`${base}/versions/${versionId}/retry-${kind}`, documentActionResultSchema, {
          ...options,
          method: "POST",
          body: {},
        }),
      );
      await guarded(reload);
    } catch (error) {
      if (mounted.current && !denied.current) setMessage(errorMessage(error));
    } finally {
      if (mounted.current) setAction(null);
    }
  }
  const versions = data ? generalUploadVersions(data) : [];
  const currentUploadIds = new Set(queue.map((entry) => entry.versionId));
  const displayedVersions = versions.filter(
    (version, index) => index < 3 || currentUploadIds.has(version.id),
  );
  const visibleQueue = queue.filter(
    (entry) =>
      entry.state !== "complete" || !versions.some((version) => version.id === entry.versionId),
  );
  return (
    <Card role="region" aria-label="Upload other documents">
      <CardHeader>
        <CardTitle>
          <h2>Upload other documents</h2>
        </CardTitle>
        <CardDescription>
          Use synthetic files only. Uploading here does not complete a task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentAccessError ? (
          <p role="alert" className="text-sm text-destructive">
            Document access is no longer available.
          </p>
        ) : documents.isPending || !documents.isFetchedAfterMount ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking document access…
          </p>
        ) : documents.error ? (
          <ErrorNotice error={documents.error} onRetry={() => void documents.refetch()} />
        ) : (
          <>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            {canUpload && data ? (
              <section
                aria-label="Other document upload drop area"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (event.dataTransfer.types.includes(demoImportMime)) {
                    const preview = readDemoImportDrag(event.dataTransfer);
                    if (preview) demoImportUpload.current(preview);
                    else
                      setMessage(
                        "This imported demo preview is unavailable. Import the text file again.",
                      );
                  } else if (event.dataTransfer.types.includes(demoDocumentMime)) {
                    const sample = readDemoDocumentDrag(event.dataTransfer);
                    if (sample) demoUpload.current(sample.document);
                    else
                      setMessage(
                        "This demo document is unavailable. Choose a sample from the demo kit again.",
                      );
                  } else addFiles(Array.from(event.dataTransfer.files));
                }}
                className={`rounded-lg border-2 border-dashed p-4 text-center ${dragging ? "border-primary bg-muted" : "border-border"}`}
              >
                <p className="mb-3 text-sm">Drop PDF or image files here</p>
                <input
                  ref={picker}
                  id={pickerId}
                  className="sr-only"
                  tabIndex={-1}
                  type="file"
                  multiple
                  accept={data.limits.allowedMimeTypes.join(",")}
                  aria-label="Choose document files"
                  onChange={(event) => {
                    addFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => picker.current?.click()}
                >
                  Choose files
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  Up to {Math.round(data.limits.maxFileBytes / 1024 / 1024)} MiB per file. Add
                  personal evidence inside its private task.
                </p>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                General uploads are unavailable for this application. Use an assigned task when it
                offers a permitted upload.
              </p>
            )}
            {visibleQueue.length > 0 && (
              <ul
                aria-label="Other document upload progress"
                className="space-y-3"
                aria-live="polite"
              >
                {visibleQueue.map((entry) => (
                  <li key={entry.id} className="space-y-2 rounded-md border p-3">
                    <p className="break-all text-sm font-medium">{entry.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.state === "preparing"
                        ? "Preparing upload…"
                        : entry.state === "uploading"
                          ? `Uploading · ${entry.percent}%`
                          : entry.state === "complete"
                            ? "Uploaded · awaiting simulated scan"
                            : entry.error}
                    </p>
                    {(entry.state === "preparing" || entry.state === "uploading") && (
                      <progress
                        className="h-2 w-full"
                        max={100}
                        value={entry.percent}
                        aria-label={`Upload progress for ${entry.file.name}`}
                      />
                    )}
                    {entry.state === "error" && (
                      <div className="flex flex-wrap gap-2">
                        {entry.retryable && canUpload && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              update(entry.id, {
                                state: "preparing",
                                percent: 0,
                                error: undefined,
                              });
                              void send([entry]);
                            }}
                          >
                            Retry upload
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setQueue((entries) => entries.filter((item) => item.id !== entry.id))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {versions.length > 0 && (
              <ul aria-label="Recent other documents" className="space-y-3">
                {displayedVersions.map((version) => (
                  <li key={version.id} className="space-y-2 rounded-md border p-3">
                    <p className="break-all text-sm font-medium">{version.fileName}</p>
                    <p className="text-xs text-muted-foreground">{generalUploadStatus(version)}</p>
                    {version.canRetryScan && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(action)}
                        onClick={() => void retryVersion(version.id, "scan")}
                      >
                        Retry simulated scan
                      </Button>
                    )}
                    {version.processing?.canRetry && version.scanState === "clean" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(action)}
                        onClick={() => void retryVersion(version.id, "processing")}
                      >
                        Retry simulated processing
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              to={documentsHref}
              className="inline-flex text-sm font-medium underline underline-offset-4"
            >
              View documents
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
