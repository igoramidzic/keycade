type Session = { csrfToken: string };

/** Transfers stay behind authenticated routes; object URLs exist only for a completed download. */
export function createDocumentTransfer({
  base,
  verify,
  error,
}: {
  base: string;
  verify: (signal?: AbortSignal) => Promise<Session>;
  error: (code: string, status: number, message: string) => Error;
}) {
  function failure(status: number, body: unknown) {
    const detail = body as { error?: { code?: string; message?: string } } | undefined;
    return error(
      detail?.error?.code ?? "DOCUMENT_UNAVAILABLE",
      status,
      detail?.error?.message ?? "This document is unavailable. Refresh the list and try again.",
    );
  }
  return {
    async upload(
      uploadId: string,
      file: File,
      progress: (value: number) => void,
      signal: AbortSignal,
    ) {
      const session = await verify(signal);
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = (result?: Error) => {
          signal.removeEventListener("abort", abort);
          if (result) reject(result);
          else resolve();
        };
        xhr.open("PUT", `${base}/uploads/${uploadId}/content`);
        xhr.timeout = 120_000;
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("x-csrf-token", session.csrfToken);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            progress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          let body: unknown;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            /* A proxy may return an empty response. */
          }
          finish(xhr.status >= 200 && xhr.status < 300 ? undefined : failure(xhr.status, body));
        };
        xhr.onerror = () =>
          finish(error("NETWORK_ERROR", 0, "The upload was interrupted. Retry this file."));
        xhr.ontimeout = () => finish(error("TIMEOUT", 0, "The upload timed out. Retry this file."));
        xhr.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        xhr.send(file);
      });
      await verify(signal);
      progress(100);
    },
    async download(versionId: string, fileName: string) {
      const signal = AbortSignal.timeout(120_000);
      await verify(signal);
      const response = await fetch(`${base}/versions/${versionId}/content`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok)
        throw failure(response.status, await response.json().catch(() => undefined));
      const blob = await response.blob();
      await verify(signal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  };
}
