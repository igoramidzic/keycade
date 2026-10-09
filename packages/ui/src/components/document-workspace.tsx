import type {
  DocumentCategory,
  DocumentView,
  FinancialFactsView,
  ReviewFinancialFacts,
  UpdateDocumentMetadata,
} from "@keycade/contracts";
import { documentCategoryLabels } from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Badge } from "@keycade/ui/components/badge";
import { Button } from "@keycade/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@keycade/ui/components/collapsible";
import {
  DocumentFinancialReview,
  documentMoney,
} from "@keycade/ui/components/document-financial-review";
import { DocumentInfo } from "@keycade/ui/components/document-info";
import { DocumentPreview } from "@keycade/ui/components/document-preview";
import { NativeSelect } from "@keycade/ui/components/native-select";
import { displayDocumentField } from "@keycade/ui/lib/document-field-display";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function DocumentWorkspace({
  document: file,
  initialVersionId,
  initialRunId,
  facts,
  factsError,
  preview,
  download,
  retryScan,
  retryProcessing,
  updateMetadata,
  correctCategory,
  review,
  reload,
  close,
  errorMessage,
}: {
  document: DocumentView;
  initialVersionId: string;
  initialRunId?: string;
  facts: FinancialFactsView | null;
  factsError?: string | null;
  preview: (versionId: string, signal: AbortSignal) => Promise<Blob>;
  download: (versionId: string, fileName: string) => Promise<unknown>;
  retryScan: (versionId: string) => Promise<unknown>;
  retryProcessing: (versionId: string) => Promise<unknown>;
  updateMetadata: (input: UpdateDocumentMetadata) => Promise<unknown>;
  correctCategory: (
    versionId: string,
    category: DocumentCategory,
    reason: string,
    expectedRevision: number,
  ) => Promise<unknown>;
  review: (input: ReviewFinancialFacts) => Promise<unknown>;
  reload: () => Promise<unknown>;
  close: () => void;
  errorMessage: (error: unknown) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [versionId, setVersionId] = useState(initialVersionId);
  const [runSelection, setRunSelection] = useState<string | null>(initialRunId ?? null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = file.versions.find((entry) => entry.id === versionId);
  const processing = version?.processing;
  const runId = runSelection ?? processing?.runId;
  const run = processing?.history.find((entry) => entry.id === runId);
  const result = run?.result;
  const fields = result?.extractedFields ?? [];
  const findings = result?.findings ?? [];
  const historical =
    version?.id !== file.currentVersionId || Boolean(run?.stale) || runId !== processing?.runId;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await reload();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function selectVersion(id: string) {
    setVersionId(id);
    setRunSelection(null);
    setPage(1);
    setError(null);
  }
  function sourcePage(value: number) {
    setPage(value);
    dialog.current
      ?.querySelector("[aria-label='Document preview']")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="fixed inset-0 m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-[90rem] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 sm:w-[calc(100%-3rem)]"
    >
      <div className="flex max-h-[94dvh] min-w-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={titleId} className="break-words text-lg font-semibold">
              {version?.metadata.displayName ?? version?.fileName ?? "Document unavailable"}
            </h2>
            <p id={`${titleId}-description`} className="text-xs text-muted-foreground">
              Private document workspace · Simulated analysis and human review
            </p>
            {version && (
              <p className="break-all text-xs text-muted-foreground">
                Version {version.version} · {version.fileName} ·{" "}
                {version.id === file.currentVersionId ? "Current version" : "Historical version"}
              </p>
            )}
          </div>
          <Button
            ref={closeButton}
            variant="outline"
            size="sm"
            aria-label="Close document workspace"
            onClick={close}
          >
            Close
          </Button>
        </header>
        {!version ? (
          <div role="alert" className="p-6">
            This document version is no longer available to your account. Close the workspace and
            refresh Documents.
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0 gap-6 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:p-6">
            <div className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              <label className="block space-y-1 text-sm font-medium">
                Document version
                <NativeSelect
                  value={versionId}
                  className="w-full"
                  onChange={(event) => selectVersion(event.target.value)}
                >
                  {file.versions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      Version {entry.version} · {entry.fileName} ·{" "}
                      {entry.id === file.currentVersionId ? "Current" : "Historical"}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <DocumentPreview
                key={version.id}
                version={version}
                page={page}
                onPageChange={setPage}
                load={preview}
                download={() => download(version.id, version.fileName)}
                errorMessage={errorMessage}
              />
              {version.canRetryScan && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => retryScan(version.id))}
                >
                  Retry simulated scan
                </Button>
              )}
            </div>
            <div className="min-w-0 space-y-5">
              {error && (
                <Alert role="alert" variant="destructive">
                  <AlertTitle>Document action incomplete</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <section aria-label="Document analysis" className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">Analysis</h3>
                  <Badge variant="secondary">Simulated</Badge>
                  <Badge variant={run?.state === "failed" ? "destructive" : "outline"}>
                    {run?.state.replaceAll("_", " ") ?? "Awaiting simulated scan"}
                  </Badge>
                  {historical && <Badge variant="outline">Historical analysis</Badge>}
                </div>
                {processing && (
                  <label className="block space-y-1 text-sm">
                    Analysis run
                    <NativeSelect
                      value={runId}
                      className="w-full"
                      onChange={(event) => setRunSelection(event.target.value)}
                    >
                      {processing.history.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          Run {entry.generation} · {entry.state.replaceAll("_", " ")}
                          {entry.id === processing.runId
                            ? " · Latest for this version"
                            : " · Historical"}
                          {entry.stale ? " · Stale source" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                )}
                {run && (
                  <p className="text-xs text-muted-foreground">
                    Run {run.generation} ·{" "}
                    {result
                      ? `Completed ${new Date(result.completedAt).toLocaleString()}`
                      : `Updated ${new Date(run.updatedAt).toLocaleString()}`}{" "}
                    · {run.attempts} attempt{run.attempts === 1 ? "" : "s"}
                  </p>
                )}
                {historical && (
                  <p className="rounded-lg border p-3 text-sm">
                    This analysis belongs to the displayed historical file or run. Its suggestions
                    cannot silently replace accepted application facts.
                  </p>
                )}
                {run && ["queued", "processing"].includes(run.state) && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Simulated analysis is {run.state === "queued" ? "queued" : "in progress"}. You
                    can close this workspace; processing continues and its saved status appears when
                    you return.
                  </p>
                )}
                {run?.state === "failed" && (
                  <p className="text-sm text-muted-foreground">
                    Simulated analysis failed. The clean original file remains available. Retry is
                    offered when the current version is eligible.
                  </p>
                )}
                {result ? (
                  <>
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">Document overview</p>
                      <p>
                        Suggested type: {documentCategoryLabels[result.category]} ·{" "}
                        {Math.round(result.confidence * 100)}% simulated confidence.
                      </p>
                      <p>
                        {result.needsReview
                          ? "Review the source and warnings before relying on these suggestions."
                          : "The simulated interpretation produced the suggestions below. Human review is required before they become application facts."}
                      </p>
                      {result.comparedApplicationBusinessName && (
                        <p>
                          Compared with application business:{" "}
                          {result.comparedApplicationBusinessName}
                        </p>
                      )}
                    </div>
                    {findings.length > 0 && (
                      <div className="space-y-3">
                        {findings.map((finding) => (
                          <div
                            key={`${finding.code}:${finding.title}`}
                            className="space-y-1 rounded-lg border p-3 text-sm"
                          >
                            <p className="font-medium">
                              {finding.title} ·{" "}
                              {finding.severity === "clear" ? "Clear" : "Review needed"}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{finding.detail}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <Collapsible defaultOpen className="rounded-lg border p-3">
                      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium w-full text-left">
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 transition-transform in-data-panel-open:rotate-90"
                        />
                        Extracted data ({fields.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <dl className="mt-4 space-y-4 text-sm">
                          {fields.map((field) => {
                            const disposition = facts?.history
                              .filter(
                                (entry) =>
                                  entry.source.versionId === version.id &&
                                  entry.source.runId === runId &&
                                  entry.fieldKey === field.key,
                              )
                              .toSorted((left, right) =>
                                right.reviewedAt.localeCompare(left.reviewedAt),
                              )[0]?.disposition;
                            return (
                              <div
                                key={field.key}
                                className="space-y-1 border-b pb-3 last:border-0 last:pb-0"
                              >
                                <dt className="font-medium">{field.label}</dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {field.kind === "money"
                                    ? documentMoney(
                                        field.value,
                                        field.provenance?.currency ?? "USD",
                                      )
                                    : displayDocumentField(field)}
                                </dd>
                                {field.provenance && (
                                  <>
                                    <dd className="text-xs text-muted-foreground">
                                      {field.provenance.period.start} to{" "}
                                      {field.provenance.period.end} ·{" "}
                                      {field.provenance.period.basis.replaceAll("_", " ")} ·{" "}
                                      {field.kind === "money" ? "Money" : field.kind}
                                    </dd>
                                    <dd>
                                      <Button
                                        variant="link"
                                        size="sm"
                                        className="h-auto max-w-full whitespace-normal p-0 text-left"
                                        onClick={() =>
                                          sourcePage(field.provenance?.sourcePage ?? 1)
                                        }
                                      >
                                        Page {field.provenance.sourcePage} ·{" "}
                                        {field.provenance.sourceLabel}
                                      </Button>
                                    </dd>
                                  </>
                                )}
                                <dd className="text-xs">
                                  {disposition === "accept"
                                    ? "Accepted"
                                    : disposition === "correct"
                                      ? "Corrected and accepted"
                                      : disposition === "reject"
                                        ? "Rejected"
                                        : "Pending review"}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                        {!fields.length && (
                          <p className="mt-3 text-sm text-muted-foreground">
                            No extracted values were supplied for this file.
                          </p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                ) : !run || !["queued", "processing", "failed"].includes(run.state) ? (
                  <p className="text-sm text-muted-foreground">
                    No completed analysis is available for this selected version.
                  </p>
                ) : null}
                {processing?.canRetry && runId === processing.runId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(() => retryProcessing(version.id))}
                  >
                    {run?.state === "failed"
                      ? "Retry simulated analysis"
                      : "Run simulated analysis"}
                  </Button>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  Suggested review: compare the business, fiscal period and source values, resolve
                  warnings, then review financial fields explicitly. Simulated findings do not
                  verify authenticity, complete a requirement or approve a loan.
                </p>
              </section>
              {factsError ? (
                <Alert role="alert" variant="destructive">
                  <AlertTitle>Financial review unavailable</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>{factsError}</p>
                    <Button size="sm" variant="outline" onClick={() => void act(reload)}>
                      Retry financial review
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : facts && runId ? (
                <DocumentFinancialReview
                  key={`${version.id}:${runId}`}
                  data={facts}
                  documentId={file.id}
                  versionId={version.id}
                  runId={runId}
                  review={review}
                  reload={reload}
                  sourcePage={sourcePage}
                  errorMessage={errorMessage}
                />
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  {facts
                    ? "Financial review will appear after analysis starts."
                    : "Loading financial review…"}
                </p>
              )}
              <DocumentInfo
                key={version.id}
                document={file}
                version={version}
                update={updateMetadata}
                correctCategory={(category, reason, expectedRevision) =>
                  correctCategory(version.id, category, reason, expectedRevision)
                }
                reload={reload}
                errorMessage={errorMessage}
              />
              <section aria-label="Versions and history" className="space-y-4 border-t pt-5">
                <h3 className="font-medium">Versions and history</h3>
                <ol className="space-y-3 text-sm">
                  {file.versions.map((entry) => (
                    <li key={entry.id} className="space-y-1 rounded-lg border p-3">
                      <p className="break-words font-medium">
                        Version {entry.version} · {entry.fileName}
                        {entry.id === file.currentVersionId ? " · Current" : " · Replaced"}
                      </p>
                      <p>
                        {new Date(entry.uploadedAt ?? entry.createdAt).toLocaleString()} · Scan{" "}
                        {entry.scanState}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => selectVersion(entry.id)}
                        disabled={entry.id === version.id}
                      >
                        View version {entry.version}
                      </Button>
                    </li>
                  ))}
                </ol>
                {processing?.overrides.map((override) => (
                  <div key={override.id} className="space-y-1 border-l-2 pl-3 text-sm">
                    <p className="font-medium">
                      Category revision {override.revision}:{" "}
                      {documentCategoryLabels[override.category]}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{override.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(override.createdAt).toLocaleString()} · Staff {override.actorUserId}
                    </p>
                  </div>
                ))}
                {version.metadata.history.map((entry) => (
                  <div key={entry.id} className="space-y-1 border-l-2 pl-3 text-sm">
                    <p className="font-medium">
                      Details revision {entry.revision} · {entry.displayName ?? version.fileName}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {entry.description ?? "No description"}
                    </p>
                    {entry.expectedPeriod && (
                      <p>
                        Expected {entry.expectedPeriod.start} to {entry.expectedPeriod.end}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{entry.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()} · Staff {entry.actorUserId}
                    </p>
                  </div>
                ))}
              </section>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
