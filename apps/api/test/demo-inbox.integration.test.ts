import { randomUUID } from "node:crypto";
import { authSessionSchema, demoInboxMessageSchema, demoInboxViewSchema } from "@keycade/contracts";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createDemoInboxCipher } from "@keycade/domain";
import { processAccessDelivery } from "@keycade/integrations/access-delivery";
import { createDemoInboxAdapter } from "@keycade/integrations/demo-inbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const origin = "https://synthetic-borrower.example.test";
const key = "73".repeat(32);
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} hosted demo inbox transport`, () => {
    async function client(enabled = true) {
      const options = {
        db: database.db,
        encryptionKey: key,
        demoSignInEnabled: true,
        demoInboxEnabled: enabled,
        authDeliveryEnabled: true,
        allowedOrigins: [origin],
        portalOrigins: { borrower: [origin] },
        nodeEnv: "production" as const,
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const server = await buildServer(options);
      let cookie = "";
      let csrf = "";
      return {
        close: () => server.close(),
        csrf(value: string) {
          csrf = value;
        },
        async call(path: string, body?: object) {
          const headers = {
            origin,
            cookie,
            "content-type": "application/json",
            "x-csrf-token": csrf,
            "cf-connecting-ip": randomUUID(),
          };
          const method = body ? "POST" : "GET";
          if (transport === "fastify") {
            const response = await server.inject({
              url: path,
              method,
              headers,
              ...(body ? { payload: JSON.stringify(body) } : {}),
            });
            if (response.headers["set-cookie"])
              cookie = String(response.headers["set-cookie"]).split(";")[0]!;
            return {
              status: response.statusCode,
              body: response.json(),
              headers: response.headers,
              requestId: String(response.headers["x-request-id"]),
            };
          }
          const response = await handleWorkerRequest(
            new Request(origin + path, {
              method,
              headers,
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          if (response.headers.has("set-cookie"))
            cookie = response.headers.get("set-cookie")!.split(";")[0]!;
          return {
            status: response.status,
            body: await response.json(),
            headers: Object.fromEntries(response.headers.entries()),
            requestId: response.headers.get("x-request-id")!,
          };
        },
      };
    }
    it("delivers inside the demo, confirms deliberately once and conceals other recipients", async () => {
      const owner = await client(),
        stranger = await client(),
        disabled = await client(false);
      const email = `hosted-transport-${randomUUID()}@example.test`;
      const input = { email, bankSlug: "bank-a", portal: "borrower", returnPath: "/" };
      const base = `/api/v1/banks/${seedIds.bankA}/demo-inbox`;
      try {
        expect((await owner.call("/api/v1/auth/session")).body).toMatchObject({
          authenticated: false,
          demoInboxEnabled: true,
        });
        expect((await owner.call(base)).status).toBe(404);
        const requested = await owner.call("/api/v1/auth/request-link", input);
        expect(requested.status).toBe(202);
        expect((await owner.call("/api/v1/auth/demo-sign-in", input)).status).toBe(200);
        const session = authSessionSchema.parse((await owner.call("/api/v1/auth/session")).body);
        if (!session.authenticated) throw new Error("Expected demo session.");
        owner.csrf(session.csrfToken);
        expect(session.demoInboxEnabled).toBe(true);
        const delivery = await database.pool.query<{ id: string }>(
          "SELECT id FROM access_delivery_requests WHERE request_id=$1",
          [requested.requestId],
        );
        const id = delivery.rows[0]!.id;
        await processAccessDelivery(
          database.db,
          id,
          createDemoInboxAdapter(database.db, { cipher: createDemoInboxCipher(key) }),
          { delayMs: 0 },
        );
        const listed = await owner.call(base);
        expect(listed.status).toBe(200);
        expect(String(listed.headers["cache-control"])).toContain("no-store");
        expect(demoInboxViewSchema.parse(listed.body).messages).toHaveLength(1);
        const detail = demoInboxMessageSchema.parse((await owner.call(`${base}/${id}`)).body);
        expect(detail.state).toBe("available");
        expect(!!detail.confirmUrl).toBe(true);
        expect(detail.text).toContain("No external email has been sent.");
        const token = new URL(detail.confirmUrl!).hash.slice("#token=".length);
        // Assertions use booleans so a failure cannot print a bearer credential.
        expect(JSON.stringify(listed.body).includes(token)).toBe(false);
        expect(detail.text.includes(token)).toBe(false);
        await stranger.call("/api/v1/auth/demo-sign-in", {
          ...input,
          email: `stranger-${randomUUID()}@example.test`,
        });
        expect((await stranger.call(`${base}/${id}`)).status).toBe(404);
        expect(demoInboxViewSchema.parse((await stranger.call(base)).body).messages).toEqual([]);
        expect((await owner.call(`/api/v1/banks/${seedIds.bankB}/demo-inbox/${id}`)).status).toBe(
          404,
        );
        await disabled.call("/api/v1/auth/demo-sign-in", input);
        expect((await disabled.call(base)).status).toBe(404);
        expect((await owner.call("/api/v1/auth/consume", { token })).status).toBe(200);
        const confirmed = authSessionSchema.parse((await owner.call("/api/v1/auth/session")).body);
        if (!confirmed.authenticated) throw new Error("Expected confirmed demo session.");
        owner.csrf(confirmed.csrfToken);
        expect(confirmed.authenticationMethod).toBe("email_link");
        const used = demoInboxMessageSchema.parse((await owner.call(`${base}/${id}`)).body);
        expect(used).toMatchObject({ state: "consumed", confirmUrl: null });
        expect(JSON.stringify(used).includes(token)).toBe(false);
        expect((await owner.call("/api/v1/auth/consume", { token })).status).toBe(400);
      } finally {
        await Promise.all([owner.close(), stranger.close(), disabled.close()]);
      }
    });
  });
}
