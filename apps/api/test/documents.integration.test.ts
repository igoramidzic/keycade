import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { syntheticDocumentPdf } from "@keycade/integrations/document-fixtures";
import { processDocumentInterpretations } from "@keycade/integrations/document-processing";
import { processDocumentScans } from "@keycade/integrations/document-scan";
import { createLocalDocumentStorage } from "@keycade/integrations/document-storage-local";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let directory: string;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  directory = await mkdtemp(path.join(tmpdir(), "keycade-http-docs-"));
});
afterAll(async () => {
  await database?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const origin = "http://localhost:3001";
const csrf = "synthetic-document-csrf-0123456789012345";
const base = `/api/v1/banks/${ids.bankA}/applications/${ids.applicationSmall}/documents`;
const immediate = { now: () => new Date(), sleep: async () => undefined };
for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} private document HTTP`, () => {
    async function client(userId: string) {
      const storage = createLocalDocumentStorage(directory);
      const options = {
        db: database.db,
        allowedOrigins: [origin],
        documentStorage: storage,
        documentLimits: { maxFileBytes: 2048, maxBatchFiles: 10 },
        authenticate: async () => ({ actor: { kind: "user" as const, userId }, csrfToken: csrf }),
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      return {
        close: () => app.close(),
        storage,
        async call(
          url: string,
          method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
          body?: object | Buffer,
          proof = csrf,
        ) {
          const headers = {
            origin,
            "x-csrf-token": proof,
            "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json",
          };
          if (transport === "fastify") {
            const response = await app.inject({
              method,
              url,
              headers,
              ...(body ? { payload: body } : {}),
            });
            return {
              status: response.statusCode,
              body: response.headers["content-type"]?.includes("application/json")
                ? response.json()
                : null,
              bytes: response.rawPayload,
              headers: response.headers,
            };
          }
          const response = await handleWorkerRequest(
            new Request(origin + url, {
              method,
              headers,
              ...(body
                ? {
                    body:
                      body instanceof Uint8Array
                        ? Uint8Array.from(body).buffer
                        : JSON.stringify(body),
                  }
                : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          const bytes = Buffer.from(await response.arrayBuffer());
          return {
            status: response.status,
            body: response.headers.get("content-type")?.includes("application/json")
              ? JSON.parse(bytes.toString())
              : null,
            bytes,
            headers: Object.fromEntries(response.headers),
          };
        },
      };
    }
    it("quarantines bytes until scanning, preserves immutable retries and protects download access", async () => {
      const user = await client(ids.borrower),
        outsider = await client(ids.officerB);
      try {
        const pdf = Buffer.from(syntheticDocumentPdf("clean-tax"));
        const input = {
          fileName: "Synthetic tax.pdf",
          mimeType: "application/pdf",
          expectedSize: pdf.length,
          idempotencyKey: randomUUID(),
        };
        const begin = await user.call(`${base}/uploads`, "POST", { files: [input] });
        expect(begin.status, JSON.stringify(begin.body)).toBe(200);
        const upload = begin.body.uploads[0];
        expect(upload.uploadId).toBeDefined();
        expect(JSON.stringify(begin.body)).not.toContain("storageKey");
        const bytesPath = `${base}/uploads/${upload.uploadId}/content`;
        const downloadPath = `${base}/versions/${upload.versionId}/content`;
        expect((await user.call(bytesPath, "PUT", pdf, "bad")).status).toBe(403);
        expect((await outsider.call(bytesPath, "PUT", pdf)).status).toBe(404);
        expect((await user.call(bytesPath, "PUT", pdf)).status).toBe(200);
        expect((await user.call(downloadPath)).status).toBe(409);
        expect((await user.call(bytesPath, "PUT", pdf)).status).toBe(200);
        const retry = await user.call(`${base}/uploads`, "POST", { files: [input] });
        expect(retry.body.uploads[0]).toMatchObject({
          uploadId: upload.uploadId,
          alreadyFinalized: true,
        });
        for (
          let i = 0;
          i < 20 &&
          (await processDocumentScans(database.db, user.storage, { clock: immediate, delayMs: 1 }));
          i++
        ) {}
        const downloaded = await user.call(downloadPath);
        expect(downloaded.status, JSON.stringify(downloaded.body)).toBe(200);
        expect(downloaded.bytes).toEqual(pdf);
        expect(downloaded.headers["content-disposition"]).toContain("attachment");
        expect((await outsider.call(downloadPath)).status).toBe(404);
        await user.storage.remove(upload.versionId);
        expect((await user.call(downloadPath)).status).toBe(409);
        const view = await user.call(base);
        expect(
          view.body.documents.find((d: { id: string }) => d.id === upload.documentId).versions[0]
            .uploadState,
        ).toBe("missing");
      } finally {
        await user.close();
        await outsider.close();
      }
    });
    it("enforces batch/size/content limits and keeps successful files after partial failures", async () => {
      const user = await client(ids.borrower);
      try {
        const pdf = Buffer.from(syntheticDocumentPdf("unknown"));
        const input = {
          fileName: "Synthetic.pdf",
          mimeType: "application/pdf",
          expectedSize: pdf.length,
          idempotencyKey: randomUUID(),
        };
        expect(
          (
            await user.call(`${base}/uploads`, "POST", {
              files: Array.from({ length: 11 }, () => ({ ...input, idempotencyKey: randomUUID() })),
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await user.call(`${base}/uploads`, "POST", {
              files: [{ ...input, fileName: "../escape.pdf" }],
            })
          ).status,
        ).toBe(400);
        const batch = await user.call(`${base}/uploads`, "POST", {
          files: [input, { ...input, expectedSize: 3000, idempotencyKey: randomUUID() }],
        });
        expect(batch.body.uploads[1].error).toBeTruthy();
        const id = batch.body.uploads[0].uploadId;
        const bytesPath = `${base}/uploads/${id}/content`;
        expect((await user.call(bytesPath, "PUT", Buffer.alloc(pdf.length, 65))).status).toBe(400);
        expect((await user.call(bytesPath, "PUT", Buffer.alloc(3000, 65))).status).toBe(413);
        expect((await user.call(bytesPath, "PUT", pdf)).status).toBe(200);
        const cancelled = await user.call(`${base}/uploads`, "POST", {
          files: [{ ...input, idempotencyKey: randomUUID() }],
        });
        expect(
          (await user.call(`${base}/uploads/${cancelled.body.uploads[0].uploadId}`, "DELETE", {}))
            .status,
        ).toBe(200);
        expect(
          (
            await user.call(
              `${base}/uploads/${cancelled.body.uploads[0].uploadId}/content`,
              "PUT",
              pdf,
            )
          ).status,
        ).toBe(409);
      } finally {
        await user.close();
      }
    });
    it("classifies clean content and enforces staff correction while preserving original machine history", async () => {
      const user = await client(ids.borrower),
        staff = await client(ids.officerA);
      try {
        const pdf = Buffer.from(syntheticDocumentPdf("clean-statement"));
        const initial = await user.call(`${base}/uploads`, "POST", {
          files: [
            {
              fileName: "Synthetic statement.pdf",
              mimeType: "application/pdf",
              expectedSize: pdf.length,
              idempotencyKey: randomUUID(),
            },
          ],
        });
        const upload = initial.body.uploads[0];
        expect(
          (await user.call(`${base}/uploads/${upload.uploadId}/content`, "PUT", pdf)).status,
        ).toBe(200);
        for (
          let i = 0;
          i < 20 && (await processDocumentScans(database.db, user.storage, { delayMs: 0 }));
          i++
        ) {}
        for (
          let i = 0;
          i < 30 &&
          (await processDocumentInterpretations(database.db, { delayMs: 0, deadlineMs: 100 }));
          i++
        ) {}
        let view = (await user.call(base)).body.documents.find(
          (d: { id: string }) => d.id === upload.documentId,
        );
        expect(view.category).toBe("bank_statement");
        const categoryPath = `${base}/${upload.documentId}/category`;
        const correction = {
          versionId: upload.versionId,
          category: "business_legal",
          reason: "Synthetic reviewer correction",
        };
        expect((await user.call(categoryPath, "POST", correction)).status).toBe(404);
        expect((await staff.call(categoryPath, "POST", correction)).status).toBe(200);
        view = (await user.call(base)).body.documents.find(
          (d: { id: string }) => d.id === upload.documentId,
        );
        expect(view.category).toBe("business_legal");
        expect(view.versions[0].processing.history[0].result.category).toBe("bank_statement");
        expect(
          (await staff.call(`${base}/versions/${upload.versionId}/retry-processing`, "POST", {}))
            .status,
        ).toBe(200);
        for (
          let i = 0;
          i < 30 &&
          (await processDocumentInterpretations(database.db, { delayMs: 0, deadlineMs: 100 }));
          i++
        ) {}
        view = (await user.call(base)).body.documents.find(
          (d: { id: string }) => d.id === upload.documentId,
        );
        expect(view.category).toBe("business_legal");
        expect(view.versions[0].processing.history.length).toBe(2);
      } finally {
        await user.close();
        await staff.close();
      }
    });
    it("shows blocked/error scans, permits error retry, and never downloads blocked bytes", async () => {
      const user = await client(ids.borrower);
      try {
        for (const scenario of ["blocked", "scan-transient"] as const) {
          const pdf = Buffer.from(syntheticDocumentPdf(scenario));
          const result = await user.call(`${base}/uploads`, "POST", {
            files: [
              {
                fileName: "Looks-clean.pdf",
                mimeType: "application/pdf",
                expectedSize: pdf.length,
                idempotencyKey: randomUUID(),
              },
            ],
          });
          const upload = result.body.uploads[0];
          expect(
            (await user.call(`${base}/uploads/${upload.uploadId}/content`, "PUT", pdf)).status,
          ).toBe(200);
          for (
            let i = 0;
            i < 20 &&
            (await processDocumentScans(database.db, user.storage, {
              clock: immediate,
              delayMs: 0,
            }));
            i++
          ) {}
          const version = (await user.call(base)).body.documents.find(
            (d: { id: string }) => d.id === upload.documentId,
          ).versions[0];
          expect(version.scanState).toBe(scenario === "blocked" ? "blocked" : "error");
          expect((await user.call(`${base}/versions/${upload.versionId}/content`)).status).toBe(
            409,
          );
          if (scenario === "scan-transient") {
            expect(
              (await user.call(`${base}/versions/${upload.versionId}/retry-scan`, "POST", {}))
                .status,
            ).toBe(200);
            await processDocumentScans(database.db, user.storage, { clock: immediate, delayMs: 0 });
            expect((await user.call(`${base}/versions/${upload.versionId}/content`)).status).toBe(
              200,
            );
          }
        }
      } finally {
        await user.close();
      }
    });
  });
}
