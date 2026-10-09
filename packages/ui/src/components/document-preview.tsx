import type { DocumentVersion } from "@keycade/contracts";
import { Alert, AlertDescription, AlertTitle } from "@keycade/ui/components/alert";
import { Button } from "@keycade/ui/components/button";
import { Input } from "@keycade/ui/components/input";
import { useEffect, useRef, useState } from "react";

type PdfViewerComponent = typeof import("./document-pdf-preview").default;

export function DocumentPreview({
  version,
  page,
  onPageChange,
  load,
  download,
  errorMessage,
}: {
  version: DocumentVersion;
  page: number;
  onPageChange: (page: number) => void;
  load: (versionId: string, signal: AbortSignal) => Promise<Blob>;
  download: () => Promise<unknown>;
  errorMessage: (error: unknown) => string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Blob | null>(null);
  const [pageCount, setPageCount] = useState<number | undefined>();
  const [PdfViewer, setPdfViewer] = useState<PdfViewerComponent | null>(null);
  const [viewerFailed, setViewerFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [downloading, setDownloading] = useState(false);
  const latest = useRef({ load, errorMessage });
  latest.current = { load, errorMessage };
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setUrl(null);
    setBytes(null);
    setPageCount(undefined);
    setError(null);
    setViewerFailed(false);
    if (version.canDownload) {
      if (version.mimeType === "application/pdf") {
        void import("./document-pdf-preview").then(
          ({ default: component }) => {
            if (active) setPdfViewer(() => component);
          },
          () => {
            if (active) {
              setViewerFailed(true);
              setError(
                "The PDF viewer could not load. Download the original file, or reload this page to load the viewer again.",
              );
            }
          },
        );
      }
      void latest.current
        .load(version.id, AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]))
        .then(
          (blob) => {
            if (!active) return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
            setBytes(blob);
          },
          (failure) => {
            if (active) setError(latest.current.errorMessage(failure));
          },
        );
    }
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [version.id, version.canDownload, version.mimeType, attempt]);
  const pdf = version.mimeType === "application/pdf";
  function changePage(value: number) {
    if (Number.isInteger(value) && value >= 1 && value <= (pageCount ?? 10000)) onPageChange(value);
  }
  async function save() {
    setDownloading(true);
    try {
      await download();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section aria-label="Document preview" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">Private file preview</h3>
        <Button
          loading={downloading}
          size="sm"
          variant="outline"
          disabled={!version.canDownload || downloading}
          onClick={() => void save()}
        >
          Download document
        </Button>
      </div>
      {version.canDownload && (
        <div
          aria-label="Preview controls"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2"
        >
          {pdf && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
              >
                Previous
              </Button>
              <label className="flex items-center gap-2 text-sm">
                Page
                <Input
                  aria-label="Page number"
                  className="w-16"
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={pageCount ?? 10000}
                  value={page}
                  onChange={(event) => changePage(Number(event.target.value))}
                />
                {pageCount ? `of ${pageCount}` : null}
              </label>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next page"
                disabled={pageCount !== undefined && page >= pageCount}
                onClick={() => changePage(page + 1)}
              >
                Next
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            disabled={zoom !== "fit" && zoom <= 50}
            onClick={() =>
              setZoom((current) => Math.max(50, (current === "fit" ? 100 : current) - 25))
            }
          >
            −
          </Button>
          <span className="text-xs" aria-live="polite">
            {zoom === "fit" ? "Fit width" : `${zoom}%`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            disabled={zoom !== "fit" && zoom >= 250}
            onClick={() =>
              setZoom((current) => Math.min(250, (current === "fit" ? 100 : current) + 25))
            }
          >
            +
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom("fit")}>
            Fit
          </Button>
        </div>
      )}
      {!version.canDownload ? (
        <div
          role="status"
          className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
        >
          Preview is unavailable.{" "}
          {version.uploadState !== "uploaded"
            ? "The file is not available in storage."
            : version.scanState === "blocked"
              ? "This file is blocked by the simulated scan."
              : "The file must pass its simulated scan before its bytes can be viewed."}{" "}
          Its permitted metadata and history remain below.
        </div>
      ) : error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Preview unavailable</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            {viewerFailed ? (
              <>
                <p>
                  Reloading the page will discard unsaved document details and financial review
                  selections. Reopen the document after the page reloads.
                </p>
                <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                  Reload page to load viewer
                </Button>
              </>
            ) : (
              <>
                <p>You can retry the preview or download the original clean file.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry preview
                </Button>
              </>
            )}
          </AlertDescription>
        </Alert>
      ) : !url ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading private preview…
        </p>
      ) : (
        <div
          data-preview-url={url}
          className="max-h-[65dvh] min-h-80 flex-1 overflow-auto rounded-lg border bg-muted sm:min-h-[28rem]"
          style={{ scrollbarGutter: "stable" }}
        >
          {pdf && bytes ? (
            PdfViewer ? (
              <PdfViewer
                key={url}
                blob={bytes}
                fileName={version.fileName}
                page={page}
                zoom={zoom}
                onLoaded={(pages) => {
                  setPageCount(pages);
                  if (page > pages) onPageChange(pages);
                }}
                onError={setError}
              />
            ) : (
              <p role="status" className="p-4 text-sm">
                Loading PDF viewer…
              </p>
            )
          ) : (
            <img
              src={url}
              alt={`Uploaded document: ${version.fileName}`}
              className="mx-auto h-auto origin-top-left"
              style={{ width: zoom === "fit" ? "100%" : `${zoom}%`, maxWidth: "none" }}
              onError={() => setError("Your browser could not display this image.")}
            />
          )}
        </div>
      )}
      {pdf && version.canDownload && (
        <p className="text-xs leading-5 text-muted-foreground">
          Preview uses the original private file. Page text is selectable; source links above open
          their cited page.
        </p>
      )}
    </section>
  );
}
