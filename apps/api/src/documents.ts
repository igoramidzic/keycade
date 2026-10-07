import {
  beginDocumentBatchSchema,
  type DocumentsView,
  documentUploadResultSchema,
} from "@keycade/contracts";
import type { Database } from "@keycade/db";
import { type Actor, createDocumentsService, DomainError } from "@keycade/domain";
import type { ByteSource, PrivateDocumentStorage } from "@keycade/integrations/documents";

export interface DocumentTransportOptions {
  documentStorage?: PrivateDocumentStorage;
  documentLimits?: { maxFileBytes: number; maxBatchFiles: number };
}
export function createDocumentTransport(db: Database, options: DocumentTransportOptions) {
  const limits = options.documentLimits ?? { maxFileBytes: 25 * 1024 * 1024, maxBatchFiles: 10 };
  const service = createDocumentsService(db, { ...limits, scanDelayMs: 0 });
  const storage = () => {
    if (!options.documentStorage)
      throw new DomainError(
        "DOCUMENT_STORAGE_UNAVAILABLE",
        503,
        "Document storage is unavailable in this environment.",
      );
    return options.documentStorage;
  };
  return {
    async list(actor: Actor, bank: string, app: string): Promise<DocumentsView> {
      const view = await service.list(actor, bank, app);
      return { ...view, canUpload: !!options.documentStorage && view.canUpload };
    },
    async begin(actor: Actor, bank: string, app: string, input: unknown, requestId: string) {
      const body = beginDocumentBatchSchema.parse(input);
      if (body.files.length > limits.maxBatchFiles)
        throw new DomainError(
          "INVALID_INPUT",
          400,
          `Choose at most ${limits.maxBatchFiles} files per batch.`,
        );
      await service.list(actor, bank, app);
      storage();
      const uploads = [];
      for (const file of body.files) {
        try {
          const result = await service.beginUpload(actor, bank, app, file, requestId);
          uploads.push({
            idempotencyKey: file.idempotencyKey,
            uploadId: result.uploadId,
            documentId: result.documentId,
            versionId: result.versionId,
            alreadyFinalized: result.alreadyFinalized,
          });
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          uploads.push({ idempotencyKey: file.idempotencyKey, error: error.message });
        }
      }
      return documentUploadResultSchema.parse({ uploads });
    },
    async put(
      actor: Actor,
      bank: string,
      app: string,
      uploadId: string,
      source: ByteSource,
      requestId: string,
    ) {
      const upload = await service.upload(actor, bank, app, uploadId);
      const bytes = await storage().write(upload.storageKey, source, {
        expectedSize: upload.expectedSize,
        mimeType: upload.mimeType,
        maxFileBytes: limits.maxFileBytes,
      });
      await service.finalizeUpload(actor, bank, app, uploadId, bytes, requestId);
      return { ok: true as const };
    },
    async cancel(actor: Actor, bank: string, app: string, uploadId: string, requestId: string) {
      const result = await service.abandonUpload(actor, bank, app, uploadId, requestId);
      await storage().remove(result.storageKey);
      return { ok: true as const };
    },
    async download(actor: Actor, bank: string, app: string, versionId: string) {
      const version = await service.download(actor, bank, app, versionId);
      const content = await storage().open(version.storageKey);
      if (!content || content.size !== version.sizeBytes) {
        await content?.body.cancel();
        await service.markMissing(versionId);
        throw new DomainError(
          "INVALID_STATE",
          409,
          "The stored file is unavailable. Upload a replacement.",
        );
      }
      return {
        body: content.body,
        headers: {
          "content-type": version.mimeType,
          "content-length": String(content.size),
          "content-disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(version.fileName).replaceAll("'", "%27")}`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      };
    },
    async retry(actor: Actor, bank: string, app: string, versionId: string, requestId: string) {
      await service.retryScan(actor, bank, app, versionId, requestId);
      return { ok: true as const };
    },
  };
}
