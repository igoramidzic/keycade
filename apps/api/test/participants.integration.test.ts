import { randomUUID } from "node:crypto";
import { authSessionSchema, participantsWorkspaceSchema } from "@keycade/contracts";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentityService } from "@keycade/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());
const borrowerOrigin = "http://localhost:3001";
const staffOrigin = "http://localhost:3002";
const applicationPath = `/api/v1/banks/${seedIds.bankA}/applications/${seedIds.applicationSmall}`;
const base = `${applicationPath}/participants`;
const invitePath = (id: string) => `/api/v1/banks/${seedIds.bankA}/invitations/${id}`;
type Credentials = { cookie: string; csrf: string; origin: string };
for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} participants HTTP journey with PostgreSQL`, () => {
    async function client(authDeliveryEnabled = true) {
      const options = {
        db: database.db,
        authDeliveryEnabled,
        demoSignInEnabled: true,
        allowedOrigins: [borrowerOrigin, staffOrigin],
        portalOrigins: { borrower: [borrowerOrigin], staff: [staffOrigin] },
        nodeEnv: "development" as const,
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      const ip = `synthetic-${randomUUID()}`;
      async function call(
        path: string,
        input: {
          method?: "GET" | "POST" | "PATCH";
          origin?: string;
          cookie?: string;
          csrf?: string;
          body?: unknown;
        } = {},
      ) {
        const origin = input.origin ?? borrowerOrigin;
        const headers = {
          host: new URL(origin).host,
          origin,
          "cf-connecting-ip": ip,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
          ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        };
        if (transport === "fastify") {
          const result = await app.inject({
            url: path,
            method: input.method ?? "GET",
            headers,
            remoteAddress: ip,
            ...(input.body === undefined ? {} : { payload: JSON.stringify(input.body) }),
          });
          return {
            status: result.statusCode,
            body: result.json(),
            cookie: String(result.headers["set-cookie"] ?? "").split(";")[0] ?? "",
            requestId: String(result.headers["x-request-id"]),
          };
        }
        const result = await handleWorkerRequest(
          new Request(origin + path, {
            method: input.method ?? "GET",
            headers,
            ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          }),
          { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
        );
        return {
          status: result.status,
          body: await result.json(),
          cookie: (result.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
          requestId: result.headers.get("x-request-id") ?? "",
        };
      }
      async function credentials(cookie: string, origin = borrowerOrigin): Promise<Credentials> {
        const response = await call("/api/v1/auth/session", { cookie, origin });
        const session = authSessionSchema.parse(response.body);
        if (!session.authenticated) throw new Error("Expected authenticated synthetic session.");
        return { cookie, origin, csrf: session.csrfToken };
      }
      async function demo(email: string, portal: "borrower" | "staff" = "borrower") {
        const origin = portal === "staff" ? staffOrigin : borrowerOrigin;
        const response = await call("/api/v1/auth/demo-sign-in", {
          method: "POST",
          origin,
          body: { email, bankSlug: "bank-a", portal, returnPath: "/" },
        });
        expect(response.status).toBe(200);
        return credentials(response.cookie, origin);
      }
      return { app, call, credentials, demo };
    }

    it("uses the emailed recipient's existing identity, accepts only explicitly, and removes access from the same active session", async () => {
      const c = await client();
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const email = `http-participant-${randomUUID()}@example.test`;
        const unverified = await c.demo(email);
        const identity = await database.pool.query("SELECT id FROM users WHERE email=$1", [email]);
        const input = {
          email,
          role: "applicant_admin",
          scope: "full",
          idempotencyKey: randomUUID(),
        };
        expect(
          (
            await c.call(`${base}/invitations`, {
              ...staff,
              csrf: undefined,
              method: "POST",
              body: input,
            })
          ).status,
        ).toBe(403);
        const response = await c.call(`${base}/invitations`, {
          ...staff,
          method: "POST",
          body: input,
        });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const workspace = participantsWorkspaceSchema.parse(response.body);
        const invitation = workspace.invitations.find((row) => row.email === email);
        if (!invitation) throw new Error("Expected synthetic invitation.");
        expect((await c.call(applicationPath, unverified)).status).toBe(404);
        expect(
          (
            await c.call(`${invitePath(invitation.id)}/accept`, {
              ...unverified,
              method: "POST",
              body: {},
            })
          ).status,
        ).toBe(404);
        const deliveries = await database.pool.query<{ id: string }>(
          "SELECT id FROM access_delivery_requests WHERE invitation_id=$1",
          [invitation.id],
        );
        const prepared = await createIdentityService(database.db).prepareDelivery(
          deliveries.rows[0]?.id ?? "",
        );
        if (!prepared) throw new Error("Expected prepared invitation delivery.");
        const token = new URLSearchParams(new URL(prepared.confirmUrl).hash.slice(1)).get("token");
        const consumed = await c.call("/api/v1/auth/consume", { method: "POST", body: { token } });
        expect(consumed.status).toBe(200);
        expect(consumed.body.returnPath).toBe(`/invitations/${invitation.id}`);
        const recipient = await c.credentials(consumed.cookie);
        expect(
          (await database.pool.query("SELECT id FROM users WHERE email=$1", [email])).rows,
        ).toEqual(identity.rows);
        expect((await c.call(applicationPath, recipient)).status).toBe(404);
        const preview = await c.call(invitePath(invitation.id), recipient);
        expect(preview.status).toBe(200);
        expect(preview.body).toMatchObject({
          id: invitation.id,
          canAccept: true,
          status: "pending",
        });
        const borrower = await c.demo("borrower@example.test");
        expect((await c.call(invitePath(invitation.id), borrower)).status).toBe(404);
        expect(
          (
            await c.call(`${invitePath(invitation.id)}/accept`, {
              ...recipient,
              csrf: undefined,
              method: "POST",
              body: {},
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await c.call(`${invitePath(invitation.id)}/accept`, {
              ...recipient,
              method: "POST",
              body: { role: "admin" },
            })
          ).status,
        ).toBe(400);
        const results = await Promise.all(
          [1, 2].map(() =>
            c.call(`${invitePath(invitation.id)}/accept`, {
              ...recipient,
              method: "POST",
              body: {},
            }),
          ),
        );
        for (const result of results) {
          expect(result.status).toBe(200);
          expect(result.body).toEqual({ applicationId: seedIds.applicationSmall });
        }
        const summary = await c.call(applicationPath, recipient);
        expect(summary.status).toBe(200);
        const write = await c.call(`${applicationPath}/purpose`, {
          ...recipient,
          method: "PATCH",
          body: {
            expectedRevision: summary.body.revision,
            purpose: "Synthetic invited administrator update",
          },
        });
        expect(write.status).toBe(200);
        const accepted = participantsWorkspaceSchema.parse((await c.call(base, staff)).body);
        const participant = accepted.participants.find((row) => row.email === email);
        if (!participant) throw new Error("Expected accepted participant.");
        const remove = { idempotencyKey: randomUUID() };
        for (let count = 0; count < 2; count++)
          expect(
            (
              await c.call(`${base}/${participant.id}/remove`, {
                ...staff,
                method: "POST",
                body: remove,
              })
            ).status,
          ).toBe(200);
        expect((await c.call("/api/v1/auth/session", recipient)).body.authenticated).toBe(true);
        for (const path of [applicationPath, `${applicationPath}/portal`, base])
          expect((await c.call(path, recipient)).status).toBe(404);
        expect(
          (
            await c.call(`${applicationPath}/purpose`, {
              ...recipient,
              method: "PATCH",
              body: {
                expectedRevision: write.body.revision,
                purpose: "Must be denied after removal",
              },
            })
          ).status,
        ).toBe(404);
        expect(
          (
            await c.call(`${invitePath(invitation.id)}/accept`, {
              ...recipient,
              method: "POST",
              body: {},
            })
          ).status,
        ).toBe(404);
      } finally {
        await c.app.close();
      }
    });

    it("validates restricted borrower invitations, tenant boundaries, idempotent commands and owner records", async () => {
      const c = await client();
      try {
        const borrower = await c.demo("borrower@example.test");
        const staff = await c.demo("officer-a@example.test", "staff");
        const email = `http-lawyer-${randomUUID()}@example.test`;
        const input = { email, idempotencyKey: randomUUID() };
        const response = await c.call(`${base}/invitations`, {
          ...borrower,
          method: "POST",
          body: input,
        });
        expect(response.status).toBe(200);
        const invitation = participantsWorkspaceSchema
          .parse(response.body)
          .invitations.find((row) => row.email === email);
        if (!invitation) throw new Error("Expected invitation.");
        expect(invitation).toMatchObject({
          role: "adviser",
          scope: "assigned",
          taskIds: [],
          documentIds: [],
          status: "pending",
        });
        expect(
          (await c.call(`${base}/invitations`, { ...borrower, method: "POST", body: input }))
            .status,
        ).toBe(200);
        expect(
          (
            await c.call(`${base}/invitations`, {
              ...borrower,
              method: "POST",
              body: { ...input, email: `different-${email}` },
            })
          ).status,
        ).toBe(409);
        for (const patch of [
          { role: "admin" },
          { role: "officer" },
          { scope: "business" },
          { taskIds: ["not-a-uuid"] },
          { taskIds: [randomUUID()] },
          { documentIds: [randomUUID()] },
          { applicationId: seedIds.applicationLarge },
        ])
          expect(
            (
              await c.call(`${base}/invitations`, {
                ...borrower,
                method: "POST",
                body: { ...input, ...patch, idempotencyKey: randomUUID() },
              })
            ).status,
          ).toBe(400);
        expect(
          (
            await c.call(`${base}/invitations`, {
              ...borrower,
              method: "POST",
              body: { ...input, scope: "full", idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(404);
        for (const path of [
          base.replace(seedIds.applicationSmall, seedIds.applicationUnshared),
          base.replace(seedIds.bankA, seedIds.bankB),
          base.replace(seedIds.applicationSmall, seedIds.applicationOtherBank),
        ])
          expect((await c.call(path, borrower)).status).toBe(404);
        for (const action of ["resend", "revoke"] as const) {
          const command = { idempotencyKey: randomUUID() };
          for (let count = 0; count < 2; count++)
            expect(
              (
                await c.call(`${base}/invitations/${invitation.id}/${action}`, {
                  ...borrower,
                  method: "POST",
                  body: command,
                })
              ).status,
            ).toBe(200);
        }
        const owners = await c.call(`${base}/relationships`, {
          ...staff,
          method: "POST",
          body: {
            displayName: `Synthetic owner ${randomUUID()}`,
            kind: "owner",
            ownershipPercent: "25.00",
            idempotencyKey: randomUUID(),
          },
        });
        expect(owners.status).toBe(200);
        expect(
          participantsWorkspaceSchema
            .parse(owners.body)
            .relationships.some((row) => row.ownershipPercent === "25.00" && row.userId === null),
        ).toBe(true);
        const spec = await c.call("/api/openapi.json");
        expect(
          spec.body.paths[
            "/api/v1/banks/{bankId}/applications/{applicationId}/participants/invitations"
          ].post.responses,
        ).toHaveProperty("409");
      } finally {
        await c.app.close();
      }
    });

    it("does not queue invitations while email delivery is unavailable", async () => {
      const c = await client(false);
      try {
        const borrower = await c.demo("borrower@example.test");
        const email = `unavailable-invitation-${randomUUID()}@example.test`;
        const response = await c.call(`${base}/invitations`, {
          ...borrower,
          method: "POST",
          body: { email, idempotencyKey: randomUUID() },
        });
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe("AUTH_DELIVERY_UNAVAILABLE");
        expect(
          (await database.pool.query("SELECT id FROM invitations WHERE email=$1", [email])).rows,
        ).toHaveLength(0);
      } finally {
        await c.app.close();
      }
    });
  });
}
