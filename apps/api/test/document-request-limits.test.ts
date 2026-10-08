import { Readable } from "node:stream";
import { createDatabase } from "@keycade/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { documentReservationMaxBytes } from "../src/documents.js";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

const { db, pool } = createDatabase("postgresql://unused:unused@127.0.0.1:1/unused");
afterAll(() => pool.end());
const origin = "http://localhost:3001";
const application =
  "/api/v1/banks/00000000-0000-4000-8000-000000000001/applications/00000000-0000-4000-8000-000000000002";
const options = {
  db,
  allowedOrigins: [origin],
  rateLimiter: { limit: async () => ({ success: true }) },
  readiness: async () => ({
    status: "ready" as const,
    database: "ready" as const,
    worker: "ready" as const,
    simulation: true as const,
  }),
};

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} document request limits`, () => {
    it("rejects streaming reservation JSON above its bounded budget before database access", async () => {
      const app = await buildServer(options);
      const cancel = vi.fn();
      const chunk = new Uint8Array(64 * 1024).fill(32);
      try {
        const path = `${application}/documents/uploads`;
        const headers = { origin, "content-type": "application/json" };
        let status: number;
        if (transport === "fastify") {
          const body = Readable.from(
            Array.from({ length: Math.floor(documentReservationMaxBytes / chunk.length) + 1 }, () =>
              Buffer.from(chunk),
            ),
          );
          const response = await app.inject({ method: "POST", url: path, headers, payload: body });
          status = response.statusCode;
        } else {
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(chunk);
            },
            cancel,
          });
          const init = { method: "POST", headers, body, duplex: "half" };
          const request = new Request(origin + path, init);
          expect(request.headers.has("content-length")).toBe(false);
          const response = await handleWorkerRequest(request, options);
          status = response.status;
          expect(cancel).toHaveBeenCalledOnce();
        }
        expect(status).toBe(413);
      } finally {
        await app.close();
      }
    });

    it("retains the 64 KiB JSON budget on other document commands", async () => {
      const app = await buildServer(options);
      try {
        const path = `${application}/documents/00000000-0000-4000-8000-000000000003/metadata`;
        const headers = { origin, "content-type": "application/json" };
        const body = " ".repeat(64 * 1024 + 1);
        const status =
          transport === "fastify"
            ? (await app.inject({ method: "POST", url: path, headers, payload: body })).statusCode
            : (
                await handleWorkerRequest(
                  new Request(origin + path, { method: "POST", headers, body }),
                  options,
                )
              ).status;
        expect(status).toBe(413);
      } finally {
        await app.close();
      }
    });
  });
}
