import type { DocumentsView, DocumentVersion } from "@keycade/contracts";

/** The general upload area never projects personal or task-specific evidence. */
export function generalUploadVersions(data: DocumentsView) {
  return data.documents
    .filter((document) => document.taskId === null && document.visibility === "shared")
    .flatMap((document) => {
      const current = document.versions.find((version) => version.id === document.currentVersionId);
      return current ? [current] : [];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** Scan/quarantine and byte availability take precedence over any interpretation. */
export function generalUploadStatus(version: DocumentVersion) {
  if (version.uploadState === "missing") return "File unavailable";
  if (version.uploadState === "abandoned") return "Upload cancelled";
  if (version.uploadState === "staged") return "Upload unfinished";
  if (version.scanState === "pending") return "Scan pending";
  if (version.scanState === "blocked") return "Blocked by scan";
  if (version.scanState === "error") return "Scan failed";
  switch (version.processing?.state) {
    case "queued":
      return "Processing queued";
    case "processing":
      return "Processing in progress";
    case "failed":
      return "Processing failed";
    case "needs_review":
      return "Ready for lender review";
    case "classified":
      return "Processing complete";
    default:
      return "Scan clean";
  }
}
