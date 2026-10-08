import { z } from "zod";
import {
  demoImportContextSchema,
  demoImportFixtureSchema,
  demoTextImportRequestSchema,
} from "./demo-import.js";
import {
  documentCategorySchema,
  documentFieldPeriodSchema,
  documentProcessingStateSchema,
  documentProcessingViewSchema,
} from "./document-processing.js";

export const documentMimeTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
export const documentActionResultSchema = z.object({ ok: z.literal(true) });
export const documentMimeTypeSchema = z.enum(documentMimeTypes);
export const documentScanStateSchema = z.enum(["pending", "clean", "blocked", "error"]);
export const documentUploadStateSchema = z.enum(["staged", "uploaded", "abandoned", "missing"]);
export const beginDocumentUploadSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine(
      (name) => !/[\\/\u0000-\u001f\u007f]/.test(name) && name !== "." && name !== "..",
      "Use a filename without a path.",
    ),
  mimeType: documentMimeTypeSchema,
  expectedSize: z.number().int().positive(),
  taskId: z.string().uuid().optional(),
  replacesDocumentId: z.string().uuid().optional(),
  demoImport: demoTextImportRequestSchema.optional(),
});
export const beginDocumentBatchSchema = z.strictObject({
  files: z.array(beginDocumentUploadSchema).min(1),
});
export const documentUploadResultSchema = z.object({
  uploads: z.array(
    z.union([
      z.object({
        idempotencyKey: z.string(),
        uploadId: z.string().uuid(),
        documentId: z.string().uuid(),
        versionId: z.string().uuid(),
        alreadyFinalized: z.boolean(),
      }),
      z.object({ idempotencyKey: z.string(), error: z.string() }),
    ]),
  ),
});
const metadataFields = {
  displayName: z.string().trim().min(1).max(180).nullable(),
  description: z.string().trim().max(2000).nullable(),
  expectedPeriod: documentFieldPeriodSchema.nullable(),
};
export const updateDocumentMetadataSchema = z.strictObject({
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  ...metadataFields,
  reason: z.string().trim().min(1).max(1000),
});
export const documentMetadataSchema = z.object({
  revision: z.number().int().nonnegative(),
  analysisRevision: z.number().int().nonnegative(),
  ...metadataFields,
  history: z.array(
    z.object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      analysisRevision: z.number().int().nonnegative(),
      ...metadataFields,
      actorUserId: z.string().uuid(),
      reason: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export const documentVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  fileName: z.string(),
  mimeType: documentMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().nullable(),
  demoImportFixture: demoImportFixtureSchema.nullable().default(null),
  uploadState: documentUploadStateSchema,
  scanState: documentScanStateSchema,
  scanErrorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  uploadedAt: z.string().datetime().nullable().default(null),
  uploadedByUserId: z.string().uuid().nullable().default(null),
  uploadedByName: z.string().nullable().default(null),
  metadata: documentMetadataSchema.default({
    revision: 0,
    analysisRevision: 0,
    displayName: null,
    description: null,
    expectedPeriod: null,
    history: [],
  }),
  canDownload: z.boolean(),
  canRetryScan: z.boolean(),
  processing: documentProcessingViewSchema.nullable().default(null),
});
export const documentViewSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  visibility: z.enum(["shared", "assigned", "private"]),
  subjectUserId: z.string().uuid().nullable(),
  currentVersionId: z.string().uuid().nullable(),
  versions: z.array(documentVersionSchema),
  canReplace: z.boolean(),
  category: documentCategorySchema.default("other"),
  processingState: documentProcessingStateSchema.nullable().default(null),
  canCorrectCategory: z.boolean().default(false),
  canEditMetadata: z.boolean().default(false),
  applicationId: z.string().uuid().optional(),
  applicationBusinessName: z.string().nullable().default(null),
  businessId: z.string().uuid().nullable().default(null),
  subjectDisplayName: z.string().nullable().default(null),
  writtenResponsePolicy: z.string().nullable().default(null),
});
export const documentsViewSchema = z.object({
  applicationId: z.string().uuid(),
  simulation: z.literal(true),
  canUpload: z.boolean(),
  demoImportContext: demoImportContextSchema.nullable().default(null),
  uploadTasks: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
  limits: z.object({
    maxFileBytes: z.number().int().positive(),
    maxBatchFiles: z.number().int().positive(),
    allowedMimeTypes: z.array(documentMimeTypeSchema),
  }),
  documents: z.array(documentViewSchema),
});
export type BeginDocumentUpload = z.infer<typeof beginDocumentUploadSchema>;
export type DocumentView = z.infer<typeof documentViewSchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type DocumentsView = z.infer<typeof documentsViewSchema>;
export type UpdateDocumentMetadata = z.infer<typeof updateDocumentMetadataSchema>;
