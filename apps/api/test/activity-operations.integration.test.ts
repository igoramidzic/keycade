import { randomUUID } from "node:crypto";
import { activityViewSchema, operationsViewSchema } from "@keycade/contracts";
import { auditEvents } from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const origin = "http://localhost:3001",
  csrf = "synthetic-operations-csrf-0123456789";
const base = `/api/v1/banks/${ids.bankA}/applications/${ids.applicationSmall}`;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
  await database.db.insert(auditEvents).values(
    Array.from({ length: 3 }, () => ({
      bankId: ids.bankA,
      applicationId: ids.applicationSmall,
      actorUserId: ids.borrower,
      actorType: "user" as const,
      action: "application.setup_saved",
      targetType: "application",
      targetId: ids.applicationSmall,
      requestId: randomUUID(),
      createdAt: new Date("2026-10-07T12:00:00Z"),
    })),
  );
}, 30000);
afterAll(async () => database?.cleanup());
for (const transport of ["fastify", "worker"] as const)
  describe(`${transport} activity and operations routes`, () => {
    async function client(userId: string) {
      const options = {
        db: database.db,
        encryptionKey: "53".repeat(32),
        allowedOrigins: [origin],
        authenticate: async () => ({ actor: { kind: "user" as const, userId }, csrfToken: csrf }),
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const server = await buildServer(options);
      return {
        close: () => server.close(),
        async call(path: string, body?: object, validCsrf = true) {
          const headers = {
            origin,
            "content-type": "application/json",
            "x-csrf-token": validCsrf ? csrf : "wrong",
          };
          if (transport === "fastify") {
            const r = await server.inject({
              url: path,
              method: body ? "POST" : "GET",
              headers,
              ...(body ? { payload: JSON.stringify(body) } : {}),
            });
            return { status: r.statusCode, body: r.json() };
          }
          const r = await handleWorkerRequest(
            new Request(origin + path, {
              method: body ? "POST" : "GET",
              headers,
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          return { status: r.status, body: await r.json() };
        },
      };
    }
    it("validates query pagination equally and scopes diagnostics and operator commands", async () => {
      const borrower = await client(ids.borrower),
        staff = await client(ids.officerA),
        outside = await client(ids.officerB);
      try {
        const first = await borrower.call(`${base}/activity?limit=1`);
        expect(first.status).toBe(200);
        const view = activityViewSchema.parse(first.body);
        expect(view.entries).toHaveLength(1);
        expect(view.nextCursor).not.toBeNull();
        const second = activityViewSchema.parse(
          (
            await borrower.call(
              `${base}/activity?limit=1&cursor=${encodeURIComponent(view.nextCursor!)}`,
            )
          ).body,
        );
        expect(second.entries).toHaveLength(1);
        expect(second.entries[0]!.id).not.toBe(view.entries[0]!.id);
        for (const query of ["limit=0", "limit=101", "cursor=bad", "limit=words"])
          expect((await staff.call(`${base}/activity?${query}`)).status).toBe(400);
        expect((await outside.call(`${base}/activity`)).status).toBe(404);
        expect((await borrower.call(`${base}/operations`)).status).toBe(404);
        expect((await outside.call(`${base}/operations`)).status).toBe(404);
        const diagnostics = await staff.call(`${base}/operations`);
        expect(diagnostics.status).toBe(200);
        expect(operationsViewSchema.parse(diagnostics.body)).toMatchObject({
          simulated: true,
          worker: { state: "unknown" },
        });
        const command = { action: "retry_notification", resourceId: randomUUID() };
        expect((await staff.call(`${base}/operations/actions`, command, false)).status).toBe(403);
        expect((await borrower.call(`${base}/operations/actions`, command)).status).toBe(404);
        expect((await staff.call(`${base}/operations/actions`, command)).status).toBe(409);
        expect(
          (await staff.call(`${base}/operations/actions`, { ...command, action: "reset_all" }))
            .status,
        ).toBe(400);
      } finally {
        await Promise.all([borrower.close(), staff.close(), outside.close()]);
      }
    });
  });
