import {
  beginDocumentBatchSchema,
  correctDocumentCategorySchema,
  type DocumentsView,
  documentUploadResultSchema,
} from "@keycade/contracts";
import { demoImportMaxFiles, readDemoImportPdfFixture } from "@keycade/contracts/demo-import";
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
      return {
        ...view,
        canUpload: !!options.documentStorage && view.canUpload,
        demoImportContext: options.documentStorage ? view.demoImportContext : null,
      };
    },
    async begin(actor: Actor, bank: string, app: string, input: unknown, requestId: string) {
      const body = beginDocumentBatchSchema.parse(input);
      if (body.files.filter((file) => file.demoImport).length > demoImportMaxFiles)
        throw new DomainError(
          "INVALID_INPUT",
          400,
          `Import up to ${demoImportMaxFiles} demo text files at a time.`,
        );
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
      // Inspect only the bounded synthetic PDF format. Ordinary uploads stay streamed.
      const sample =
        upload.mimeType === "application/pdf" && upload.expectedSize <= 128 * 1024
          ? new Uint8Array(upload.expectedSize)
          : null;
      const inspected: ByteSource = {
        cancel: (reason) => source.cancel?.(reason) ?? Promise.resolve(),
        async *[Symbol.asyncIterator]() {
          let offset = 0;
          for await (const chunk of source) {
            if (sample && offset + chunk.length <= sample.length) sample.set(chunk, offset);
            offset += chunk.length;
            yield chunk;
          }
        },
      };
      const bytes = await storage().write(upload.storageKey, inspected, {
        expectedSize: upload.expectedSize,
        mimeType: upload.mimeType,
        maxFileBytes: limits.maxFileBytes,
        expectedSha256: upload.expectedSha256,
      });
      await service.finalizeUpload(
        actor,
        bank,
        app,
        uploadId,
        {
          ...bytes,
          demoImportFixture: sample ? readDemoImportPdfFixture(sample) : null,
        },
        requestId,
      );
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
    async retryProcessing(
      actor: Actor,
      bank: string,
      app: string,
      versionId: string,
      requestId: string,
    ) {
      await service.retryProcessing(actor, bank, app, versionId, requestId);
      return { ok: true as const };
    },
    async correctCategory(
      actor: Actor,
      bank: string,
      app: string,
      documentId: string,
      input: unknown,
      requestId: string,
    ) {
      await service.correctCategory(
        actor,
        bank,
        app,
        documentId,
        correctDocumentCategorySchema.parse(input),
        requestId,
      );
      return { ok: true as const };
    },
    async updateMetadata(
      actor: Actor,
      bank: string,
      app: string,
      documentId: string,
      input: unknown,
      requestId: string,
    ) {
      await service.updateMetadata(actor, bank, app, documentId, input, requestId);
      return { ok: true as const };
    },
    async retry(actor: Actor, bank: string, app: string, versionId: string, requestId: string) {
      await service.retryScan(actor, bank, app, versionId, requestId);
      return { ok: true as const };
    },
  };
}
