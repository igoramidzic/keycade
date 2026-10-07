import { createHash } from "node:crypto";
import { DomainError } from "@keycade/domain";

export type ByteSource = AsyncIterable<Uint8Array> & {
  /** Interrupt an in-flight upstream read when its downstream storage operation fails. */
  cancel?(reason?: unknown): Promise<void>;
};
export interface PrivateDocumentStorage {
  write(
    key: string,
    source: ByteSource,
    options: { expectedSize: number; mimeType: string; maxFileBytes: number },
  ): Promise<{ size: number; sha256: string }>;
  open(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  remove(key: string): Promise<void>;
  cleanupStaging(before: Date): Promise<void>;
}
export const documentDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Format checks are a prototype upload boundary, not a malware verdict. Scan remains separate. */
export function validateDocumentContent(
  head: Uint8Array,
  tail: Uint8Array,
  mimeType: string,
  size: number,
) {
  const start = Buffer.from(head);
  const end = Buffer.from(tail);
  let valid = false;
  if (mimeType === "application/pdf") {
    valid =
      /^%PDF-[12]\.\d[\r\n]/.test(start.toString("latin1", 0, 16)) &&
      /%%EOF\s*$/.test(end.toString("latin1")) &&
      size >= 64;
  } else if (mimeType === "image/png") {
    valid =
      start.length >= 33 &&
      start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      start.readUInt32BE(8) === 13 &&
      start.toString("ascii", 12, 16) === "IHDR" &&
      start.readUInt32BE(16) > 0 &&
      start.readUInt32BE(20) > 0 &&
      end.length >= 12 &&
      end.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])) &&
      size > 45;
  } else if (mimeType === "image/jpeg") {
    valid =
      start.length >= 4 &&
      start[0] === 255 &&
      start[1] === 216 &&
      start[2] === 255 &&
      end.length >= 2 &&
      end.at(-2) === 255 &&
      end.at(-1) === 217 &&
      size >= 32;
  }
  if (!valid)
    throw new DomainError(
      "INVALID_INPUT",
      400,
      "The file content does not match a supported PDF, JPEG, or PNG file.",
    );
}

export function webByteSource(body: ReadableStream<Uint8Array> | null): ByteSource {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;
  const cancel = async (reason?: unknown) => {
    cancelled = true;
    await (reader ? reader.cancel(reason) : body?.cancel(reason))?.catch(() => undefined);
  };
  return {
    cancel,
    async *[Symbol.asyncIterator]() {
      if (!body) throw new DomainError("INVALID_INPUT", 400, "The upload is empty.");
      if (cancelled) return;
      const current = body.getReader();
      reader = current;
      try {
        while (!cancelled) {
          const chunk = await current.read();
          if (chunk.done) return;
          yield chunk.value;
        }
      } finally {
        await current.cancel().catch(() => undefined);
        current.releaseLock();
        reader = undefined;
      }
    },
  };
}
