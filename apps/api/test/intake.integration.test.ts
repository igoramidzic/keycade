import { randomUUID } from "node:crypto";
import { publicIntakeSchema } from "@keycade/contracts";
import { banks, loanProducts } from "@keycade/db";
import { createTestDatabase } from "@keycade/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const bankId = randomUUID();
const productId = randomUUID();
const origin = "http://localhost:3001";
beforeAll(async () => {
  database = await createTestDatabase();
  await database.db.insert(banks).values({
    id: bankId,
    slug: "catalog-bank",
    name: "Synthetic Catalog Bank",
    synthetic: true,
  });
  await database.db.insert(loanProducts).values({
    id: productId,
    bankId,
    slug: "business-credit",
    name: "Synthetic Business Credit",
    minimumAmount: "10000.00",
    maximumAmount: "7500000.00",
    synthetic: true,
  });
}, 30_000);
afterAll(async () => database?.cleanup());

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} public intake HTTP configuration`, () => {
    async function client() {
      const options = {
        db: database.db,
        allowedOrigins: [origin],
        // Public configuration must remain independent of any supplied session or role.
        authenticate: async () => {
          throw new Error("Public catalog must not resolve authentication.");
        },
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      async function call(path: string, method: "GET" | "HEAD" = "GET") {
        const headers = { "x-bank-id": randomUUID(), "x-bank-role": "admin" };
        if (transport === "fastify") {
          const result = await app.inject({ url: path, method, headers });
          return { status: result.statusCode, body: result.body, headers: result.headers };
        }
        const result = await handleWorkerRequest(new Request(origin + path, { method, headers }), {
          ...options,
          rateLimiter: { limit: async () => ({ success: true }) },
        });
        return {
          status: result.status,
          body: await result.text(),
          headers: Object.fromEntries(result.headers),
        };
      }
      return { app, call };
    }

    it("serves the allowlisted catalog anonymously without creating application state", async () => {
      const c = await client();
      try {
        const response = await c.call("/api/v1/public/banks/catalog-bank/intake");
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
          bank: {
            id: bankId,
            slug: "catalog-bank",
            name: "Synthetic Catalog Bank",
            synthetic: true,
          },
          products: [
            {
              id: productId,
              slug: "business-credit",
              name: "Synthetic Business Credit",
              version: 1,
              minimumAmount: "10000.00",
              maximumAmount: "7500000.00",
              currency: "USD",
            },
          ],
        });
        expect(publicIntakeSchema.safeParse(JSON.parse(response.body)).success).toBe(true);
        expect(response.headers["cache-control"]).toBe("no-store");
        const result = await database.pool.query("SELECT count(*)::int AS count FROM applications");
        expect(result.rows[0]?.count).toBe(0);
        const head = await c.call("/api/v1/public/banks/catalog-bank/intake", "HEAD");
        expect(head.status).toBe(200);
        expect(head.body).toBe("");
        const openapi = await c.call("/api/openapi.json");
        expect(openapi.body).toContain('"/api/v1/public/banks/{bankSlug}/intake"');
        expect(openapi.body).toContain('"maximumAmount"');
      } finally {
        await c.app.close();
      }
    });

    it("returns safe errors for unknown banks, malformed slugs, and tenant/product overrides", async () => {
      const c = await client();
      try {
        const missing = await c.call("/api/v1/public/banks/missing-bank/intake");
        expect(missing.status).toBe(404);
        expect(JSON.parse(missing.body).error).toMatchObject({
          code: "NOT_FOUND",
          message: "Resource not found.",
        });
        for (const path of [
          "/api/v1/public/banks/UPPERCASE/intake",
          `/api/v1/public/banks/${"a".repeat(81)}/intake`,
          `/api/v1/public/banks/catalog-bank/intake?bankId=${randomUUID()}`,
          `/api/v1/public/banks/catalog-bank/intake?productId=${randomUUID()}`,
        ]) {
          const response = await c.call(path);
          expect(response.status).toBe(400);
          expect(JSON.parse(response.body).error).toMatchObject({
            code: "INVALID_INPUT",
            message: "Invalid request.",
          });
        }
      } finally {
        await c.app.close();
      }
    });
  });
}
