import { createHash, randomUUID } from "node:crypto";
import type { FixedLengthStream, R2Bucket } from "@cloudflare/workers-types";
import { DomainError } from "@keycade/domain";
import { type PrivateDocumentStorage, validateDocumentContent } from "./document-content.js";

/** Private R2 objects are mediated by the API; the bucket has no public domain. */
export function createR2DocumentStorage(
  bucket: R2Bucket,
  fixedLength: (size: number) => FixedLengthStream,
): PrivateDocumentStorage {
  function safeKey(key: string) {
    if (!/^[a-z0-9-]{1,150}$/.test(key)) throw new Error("Invalid private storage key.");
    return key;
  }
  return {
    async write(key, source, options) {
      safeKey(key);
      if (options.expectedSize > options.maxFileBytes)
        throw new DomainError("INVALID_INPUT", 413, "The file exceeds its upload size limit.");
      const temporary = `staging-${randomUUID()}`;
      const stream = fixedLength(options.expectedSize);
      const writer = stream.writable.getWriter();
      let head = Buffer.alloc(0),
        tail = Buffer.alloc(0),
        size = 0;
      const hash = createHash("sha256");
      let failure: { error: unknown } | undefined;
      const copy = async () => {
        try {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > options.expectedSize || size > options.maxFileBytes)
              throw new DomainError(
                "INVALID_INPUT",
                413,
                "The file exceeds its upload size limit.",
              );
            if (head.length < 4096) head = Buffer.concat([head, chunk]).subarray(0, 4096);
            tail = Buffer.concat([tail, chunk]).subarray(-4096);
            hash.update(chunk);
            await writer.write(chunk);
          }
          if (size !== options.expectedSize)
            throw new DomainError(
              "INVALID_INPUT",
              400,
              "The upload was incomplete. Retry the file.",
            );
          validateDocumentContent(head, tail, options.mimeType, size);
          await writer.close();
        } catch (error) {
          failure ??= { error };
          await writer.abort(error).catch(() => undefined);
          throw error;
        }
      };
      const transfer = copy();
      const stored = bucket.put(temporary, stream.readable).catch(async (error) => {
        failure ??= { error };
        // Aborting the writer cannot interrupt source.next() while a client is stalled.
        // Cancel the request reader as well so transfer settles and staging is cleaned up.
        await Promise.allSettled([writer.abort(error), source.cancel?.(error)]);
        throw error;
      });
      try {
        const results = await Promise.allSettled([transfer, stored]);
        if (failure) throw failure.error;
        for (const result of results) if (result.status === "rejected") throw result.reason;
        const sha256 = hash.digest("hex");
        const staged = await bucket.get(temporary);
        if (!staged) throw new Error("Staged document is missing.");
        const published = await bucket.put(key, staged.body, {
          onlyIf: { etagDoesNotMatch: "*" },
          sha256,
          customMetadata: { sha256 },
        });
        if (!published) {
          await staged.body.cancel().catch(() => undefined);
          const existing = await bucket.head(key);
          if (existing?.size !== size || existing.customMetadata?.sha256 !== sha256)
            throw new DomainError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "This upload already contains different bytes. Start a new upload.",
            );
        }
        return { size, sha256 };
      } finally {
        await bucket.delete(temporary);
      }
    },
    async open(key) {
      const object = await bucket.get(safeKey(key));
      if (!object) return null;
      const reader = object.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel();
        },
      });
      return { size: object.size, body };
    },
    async remove(key) {
      await bucket.delete(safeKey(key));
    },
    async cleanupStaging(before) {
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: "staging-", cursor, limit: 100 });
        const expired = page.objects.filter((o) => o.uploaded < before).map((o) => o.key);
        if (expired.length) await bucket.delete(expired);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    },
  };
}
