import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentDigest, webByteSource } from "./document-content.js";
import { syntheticDocumentPdf } from "./document-fixtures.js";
import { simulateDocumentScan } from "./document-scan.js";
import { createLocalDocumentStorage } from "./document-storage-local.js";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "keycade-doc-test-"));
  directories.push(directory);
  return { directory, storage: createLocalDocumentStorage(directory) };
}
async function* source(bytes: Uint8Array) {
  for (let n = 0; n < bytes.length; n += 17) yield bytes.subarray(n, n + 17);
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.useRealTimers();
});
describe("private document storage", () => {
  it("streams immutable bytes with private permissions and concurrent duplicate retry protection", async () => {
    const { storage, directory } = await fixture();
    const bytes = syntheticDocumentPdf("clean-tax");
    const options = {
      expectedSize: bytes.length,
      maxFileBytes: 25 * 1024 * 1024,
      mimeType: "application/pdf",
    };
    const results = await Promise.all([
      storage.write("test-version", source(bytes), options),
      storage.write("test-version", source(bytes), options),
    ]);
    expect(results[0]).toEqual({ size: bytes.length, sha256: documentDigest(bytes) });
    expect(results[1]).toEqual(results[0]);
    expect((await stat(path.join(directory, "test-version"))).mode & 0o777).toBe(0o600);
    const file = await storage.open("test-version");
    const chunks = [];
    if (file) for await (const chunk of webByteSource(file.body)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    const changed = syntheticDocumentPdf("scan-error");
    await expect(
      storage.write("test-version", source(changed), { ...options, expectedSize: changed.length }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await readdir(directory)).toEqual(["test-version"]);
  });
  it("rejects spoofing, truncated bytes, oversize streams, paths and interrupted streams without leaving partial bytes", async () => {
    const { storage, directory } = await fixture();
    const bytes = syntheticDocumentPdf("unknown");
    const options = {
      expectedSize: bytes.length,
      maxFileBytes: bytes.length,
      mimeType: "application/pdf",
    };
    for (const invalid of [
      new TextEncoder().encode("<html>pretend PDF</html>"),
      bytes.subarray(0, 40),
    ]) {
      await expect(
        storage.write("test-version", source(invalid), {
          ...options,
          expectedSize: invalid.length,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(
      storage.write("test-version", source(bytes), { ...options, mimeType: "image/png" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      storage.write("test-version", source(bytes), { ...options, maxFileBytes: 10 }),
    ).rejects.toMatchObject({ statusCode: 413 });
    await expect(
      storage.write("test-version", source(bytes), { ...options, expectedSize: bytes.length + 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    async function* interrupted() {
      yield bytes.subarray(0, 50);
      throw new Error("interrupted");
    }
    await expect(storage.write("test-version", interrupted(), options)).rejects.toThrow(
      "interrupted",
    );
    await expect(storage.write("../escape", source(bytes), options)).rejects.toThrow(
      "Invalid private storage key",
    );
    expect(await readdir(directory)).toEqual([]);
    expect(await storage.open("missing")).toBeNull();
  });
});
it("simulates delayed hash-selected scan outcomes independently of names with an injected clock", async () => {
  const sleep = vi.fn(async () => undefined);
  const clock = { now: () => new Date("2026-10-07T10:00:00Z"), sleep };
  expect(
    (
      await simulateDocumentScan(documentDigest(syntheticDocumentPdf("blocked")), 1, {
        clock,
        delayMs: 123,
      })
    ).state,
  ).toBe("blocked");
  expect(
    (
      await simulateDocumentScan(documentDigest(syntheticDocumentPdf("scan-error")), 1, {
        clock,
        delayMs: 123,
      })
    ).state,
  ).toBe("error");
  expect(
    (
      await simulateDocumentScan(documentDigest(syntheticDocumentPdf("scan-transient")), 2, {
        clock,
        delayMs: 123,
      })
    ).state,
  ).toBe("clean");
  expect((await simulateDocumentScan("unknown-hash", 1, { clock, delayMs: 123 })).simulated).toBe(
    true,
  );
  expect(sleep).toHaveBeenCalledWith(123, undefined);
});
