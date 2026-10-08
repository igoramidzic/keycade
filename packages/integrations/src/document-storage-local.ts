import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@keycade/domain";
import { type PrivateDocumentStorage, validateDocumentContent } from "./document-content.js";

/** All keys are server-generated opaque IDs. Original names never become filesystem paths. */
export function createLocalDocumentStorage(root: string): PrivateDocumentStorage {
  const directory = path.resolve(root);
  const filePath = (key: string) => {
    if (!/^[a-z0-9-]{1,150}$/.test(key)) throw new Error("Invalid private storage key.");
    return path.join(directory, key);
  };
  const initialize = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  };
  const remove = async (key: string) => {
    await unlink(filePath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
  return {
    async write(key, source, options) {
      await initialize();
      const temporaryKey = `staging-${randomUUID()}`;
      const temporary = filePath(temporaryKey);
      const file = await open(temporary, "wx", 0o600);
      let size = 0;
      let head = Buffer.alloc(0);
      let tail = Buffer.alloc(0);
      const digest = createHash("sha256");
      try {
        for await (const chunk of source) {
          size += chunk.byteLength;
          if (size > options.maxFileBytes || size > options.expectedSize)
            throw new DomainError("INVALID_INPUT", 413, "The file exceeds its upload size limit.");
          if (head.length < 4096) head = Buffer.concat([head, chunk]).subarray(0, 4096);
          tail = Buffer.concat([tail, chunk]).subarray(-4096);
          digest.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const result = await file.write(chunk, offset, chunk.byteLength - offset);
            offset += result.bytesWritten;
          }
        }
        if (size !== options.expectedSize)
          throw new DomainError("INVALID_INPUT", 400, "The upload was incomplete. Retry the file.");
        validateDocumentContent(head, tail, options.mimeType, size);
        const sha256 = digest.digest("hex");
        if (options.expectedSha256 && options.expectedSha256 !== sha256)
          throw new DomainError(
            "INVALID_INPUT",
            400,
            "The uploaded bytes do not match the registered demo recipe. Retry the generated PDF.",
          );
        await file.sync();
        await file.close();
        try {
          // Atomic and immutable, including concurrent retries. Never overwrite an existing version.
          await link(temporary, filePath(key));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const existing = await open(filePath(key), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const hash = createHash("sha256");
            for await (const chunk of existing.createReadStream({ autoClose: false }))
              hash.update(chunk);
            if (hash.digest("hex") !== sha256)
              throw new DomainError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "This upload already contains different bytes. Start a new upload.",
              );
          } finally {
            await existing.close();
          }
        }
        return { size, sha256 };
      } finally {
        await file.close();
        await remove(temporaryKey);
      }
    },
    async open(key) {
      let file;
      try {
        file = await open(filePath(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      const metadata = await file.stat();
      if (!metadata.isFile()) {
        await file.close();
        throw new Error("Invalid private storage object.");
      }
      const stream = file.createReadStream();
      const iterator = stream[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await iterator.next();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          stream.destroy();
          await file.close();
        },
      });
      return { body, size: metadata.size };
    },
    remove,
    async cleanupStaging(before) {
      await initialize();
      for (const entry of await readdir(directory)) {
        if (!/^staging-[a-f0-9-]{36}$/.test(entry)) continue;
        const metadata = await stat(filePath(entry)).catch(() => null);
        if (metadata && metadata.mtime < before) await remove(entry);
      }
    },
  };
}
