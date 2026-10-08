import type { FixedLengthStream, R2Bucket } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { webByteSource } from "./document-content.js";
import { syntheticDocumentPdf } from "./document-fixtures.js";
import { createR2DocumentStorage } from "./document-storage-r2.js";

function fixture() {
  const bucket = {
    put: vi.fn<R2Bucket["put"]>(),
    get: vi.fn<R2Bucket["get"]>().mockResolvedValue(null),
    head: vi.fn<R2Bucket["head"]>().mockResolvedValue(null),
    delete: vi.fn<R2Bucket["delete"]>().mockResolvedValue(undefined),
    list: vi.fn<R2Bucket["list"]>(),
    createMultipartUpload: vi.fn<R2Bucket["createMultipartUpload"]>(),
    resumeMultipartUpload: vi.fn<R2Bucket["resumeMultipartUpload"]>(),
  };
  // This test double uses only standard reader/writer operations. Node lacks the
  // Workers-only BYOB readAtLeast method and FixedLengthStream size enforcement.
  const fixedLength = () =>
    new TransformStream<Uint8Array, Uint8Array>() as unknown as FixedLengthStream;
  return { bucket, storage: createR2DocumentStorage(bucket, fixedLength) };
}
async function within<T>(operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Storage failed to cancel its upstream stream.")),
          1000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
describe("R2 upload cancellation", () => {
  it("does not publish a generated recipe when its reserved checksum differs", async () => {
    const { bucket, storage } = fixture();
    const bytes = syntheticDocumentPdf("clean-tax");
    bucket.put.mockImplementation(async (_key, input) => {
      if (!input || typeof input !== "object" || !("getReader" in input))
        throw new Error("Expected stream input.");
      const reader = input.getReader();
      while (!(await reader.read()).done) {
        /* consume staging */
      }
      return {} as Awaited<ReturnType<R2Bucket["put"]>>;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    await expect(
      storage.write("recipe-version", webByteSource(body), {
        expectedSize: bytes.length,
        maxFileBytes: bytes.length,
        mimeType: "application/pdf",
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.calls[0]?.[0]).toMatch(/^staging-/);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.delete).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^staging-/));
  });
  it("interrupts a stalled upstream read after a midstream R2 failure and removes staging", async () => {
    const { bucket, storage } = fixture();
    const bytes = syntheticDocumentPdf("clean-tax");
    const failure = new Error("synthetic R2 failure");
    const cancel = vi.fn();
    let paused: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      paused = resolve;
    });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          if (pulls === 1) controller.enqueue(bytes.subarray(0, 50));
          else paused();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    bucket.put.mockImplementation(async (_key, input) => {
      if (!input || typeof input !== "object" || !("getReader" in input))
        throw new Error("Expected stream input.");
      const reader = input.getReader();
      await reader.read();
      await waiting;
      await reader.cancel(failure);
      throw failure;
    });
    await expect(
      within(
        storage.write("synthetic-version", webByteSource(body), {
          expectedSize: bytes.length,
          maxFileBytes: bytes.length,
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(failure);
    expect(body.locked).toBe(false);
    expect(pulls).toBe(2);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.delete).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^staging-/));
  });
  it("cancels a body stalled before its first chunk when R2 rejects immediately", async () => {
    const { bucket, storage } = fixture();
    const failure = new Error("synthetic unavailable bucket");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    bucket.put.mockRejectedValue(failure);
    await expect(
      within(
        storage.write("synthetic-version", webByteSource(body), {
          expectedSize: 100,
          maxFileBytes: 100,
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledWith(failure);
    expect(body.locked).toBe(false);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
  });
  it("supports cancellation before consumption and releases the reader after an early consumer exit", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const source = webByteSource(body);
    await source.cancel?.("stopped");
    const chunks = [];
    for await (const chunk of source) chunks.push(chunk);
    expect(chunks).toEqual([]);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    const earlyCancel = vi.fn();
    const earlyBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel: earlyCancel,
    });
    for await (const _chunk of webByteSource(earlyBody)) break;
    expect(earlyCancel).toHaveBeenCalledOnce();
    expect(earlyBody.locked).toBe(false);
  });
  it("preserves a source validation failure when aborting R2 causes a second error", async () => {
    const { bucket, storage } = fixture();
    const bytes = new TextEncoder().encode("Synthetic unsupported file content");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    bucket.put.mockImplementation(async (_key, input) => {
      if (!input || typeof input !== "object" || !("getReader" in input))
        throw new Error("Expected stream input.");
      const reader = input.getReader();
      try {
        while (!(await reader.read()).done) {
          /* consume the staged stream */
        }
      } catch {
        throw new Error("synthetic secondary downstream abort");
      }
      throw new Error("Invalid content must not close successfully.");
    });
    await expect(
      within(
        storage.write("synthetic-version", webByteSource(body), {
          expectedSize: bytes.length,
          maxFileBytes: 100,
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", statusCode: 400 });
    expect(body.locked).toBe(false);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
  });
});
