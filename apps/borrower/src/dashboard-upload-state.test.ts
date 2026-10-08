import type { DocumentsView, DocumentVersion } from "@keycade/contracts";
import { expect, test } from "vitest";
import { generalUploadStatus, generalUploadVersions } from "./dashboard-upload-state";

function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: "current",
    version: 1,
    fileName: "synthetic-evidence.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    sha256: null,
    demoImportFixture: null,
    uploadState: "uploaded",
    scanState: "clean",
    scanErrorCode: null,
    createdAt: "2026-10-08T12:00:00.000Z",
    uploadedAt: null,
    uploadedByUserId: null,
    uploadedByName: null,
    metadata: {
      revision: 0,
      analysisRevision: 0,
      displayName: null,
      description: null,
      expectedPeriod: null,
      history: [],
    },
    canDownload: true,
    canRetryScan: false,
    processing: null,
    ...overrides,
  };
}

function processing(state: NonNullable<DocumentVersion["processing"]>["state"]) {
  return {
    runId: "run",
    state,
    simulated: true as const,
    category: null,
    confidence: null,
    extractedFields: [],
    findings: [],
    suggestedTasks: [],
    manualCategory: null,
    overrides: [],
    history: [],
    errorCode: null,
    canRetry: false,
    canCorrectCategory: false,
  };
}

test("the general upload projection excludes task/private evidence and superseded versions", () => {
  const current = version();
  const general = {
    id: "general",
    taskId: null,
    visibility: "shared" as const,
    subjectUserId: null,
    currentVersionId: "current",
    versions: [version({ id: "older", scanState: "error" }), current],
    canReplace: true,
    category: "other" as const,
    processingState: null,
    canCorrectCategory: false,
    canEditMetadata: false,
    applicationBusinessName: null,
    businessId: null,
    subjectDisplayName: null,
    writtenResponsePolicy: null,
  };
  const data: DocumentsView = {
    applicationId: "application",
    simulation: true,
    canUpload: true,
    demoImportContext: null,
    uploadTasks: [],
    limits: { maxFileBytes: 1000, maxBatchFiles: 5, allowedMimeTypes: ["application/pdf"] },
    documents: [
      general,
      { ...general, id: "business-task", taskId: "task" },
      { ...general, id: "private-task", taskId: "private", visibility: "private" },
      { ...general, id: "restricted", visibility: "assigned" },
      { ...general, id: "no-current", currentVersionId: "not-visible" },
    ],
  };
  expect(generalUploadVersions(data)).toEqual([current]);
});

test("quarantine and missing bytes override a previously successful interpretation", () => {
  const interpreted = version({ processing: processing("classified") });
  expect(generalUploadStatus(interpreted)).toBe("Simulated processing complete");
  expect(generalUploadStatus({ ...interpreted, scanState: "blocked" })).toBe(
    "Blocked by simulated scan",
  );
  expect(generalUploadStatus({ ...interpreted, scanState: "pending" })).toBe(
    "Simulated scan pending",
  );
  expect(generalUploadStatus({ ...interpreted, uploadState: "missing" })).toBe("File unavailable");
});

test("a clean scan distinguishes in-progress, failed and human-review interpretation states", () => {
  expect(generalUploadStatus(version({ processing: processing("queued") }))).toBe(
    "Simulated processing queued",
  );
  expect(generalUploadStatus(version({ processing: processing("processing") }))).toBe(
    "Simulated processing in progress",
  );
  expect(generalUploadStatus(version({ processing: processing("failed") }))).toBe(
    "Simulated processing failed",
  );
  expect(generalUploadStatus(version({ processing: processing("needs_review") }))).toBe(
    "Ready for lender review",
  );
});
