import { randomUUID } from "node:crypto";
import { authSessionSchema } from "@keycade/contracts";
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
const ready = async () => ({
  status: "ready" as const,
  database: "ready" as const,
  worker: "ready" as const,
  simulation: true as const,
});

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} passwordless HTTP journey with PostgreSQL`, () => {
    async function client(demoSignInEnabled = false) {
      const options = {
        db: database.db,
        demoSignInEnabled,
        allowedOrigins: [borrowerOrigin, staffOrigin],
        portalOrigins: { borrower: [borrowerOrigin], staff: [staffOrigin] },
        nodeEnv: "development" as const,
        readiness: ready,
      };
      const app = await buildServer(options);
      const call = async (
        path: string,
        input: {
          method?: "GET" | "POST" | "PATCH";
          origin?: string;
          cookie?: string;
          csrf?: string;
          body?: unknown;
          ip?: string;
          omitOrigin?: boolean;
        } = {},
      ) => {
        const origin = input.origin ?? borrowerOrigin;
        const headers: Record<string, string> = {
          host: new URL(origin).host,
          "cf-connecting-ip": input.ip ?? "synthetic-client",
          ...(input.omitOrigin ? {} : { origin }),
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
          ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        };
        if (transport === "fastify") {
          const response = await app.inject({
            method: input.method ?? "GET",
            url: path,
            headers,
            remoteAddress: input.ip ?? "127.0.0.1",
            ...(input.body === undefined ? {} : { payload: JSON.stringify(input.body) }),
          });
          return {
            status: response.statusCode,
            body: response.json(),
            cookie: String(response.headers["set-cookie"] ?? ""),
            requestId: String(response.headers["x-request-id"]),
          };
        }
        const response = await handleWorkerRequest(
          new Request(origin + path, {
            method: input.method ?? "GET",
            headers,
            ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          }),
          { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
        );
        return {
          status: response.status,
          body: await response.json(),
          cookie: response.headers.get("set-cookie") ?? "",
          requestId: response.headers.get("x-request-id") ?? "",
        };
      };
      const requestLink = async (email: string, portal: "borrower" | "staff" = "borrower") => {
        const origin = portal === "borrower" ? borrowerOrigin : staffOrigin;
        const response = await call("/api/v1/auth/request-link", {
          method: "POST",
          origin,
          body: { email, bankSlug: "bank-a", portal, returnPath: "/" },
        });
        expect(response.status).toBe(202);
        const result = await database.pool.query<{ id: string }>(
          "SELECT id FROM access_delivery_requests WHERE request_id = $1",
          [response.requestId],
        );
        const deliveryId = result.rows[0]?.id;
        if (!deliveryId) throw new Error("Expected queued synthetic delivery.");
        const delivery = await createIdentityService(database.db).prepareDelivery(deliveryId);
        if (!delivery) throw new Error("Expected synthetic credential preparation.");
        const token = new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token");
        return { token, origin, response };
      };
      return { app, call, requestLink };
    }

    it("uses opt-in synthetic demo sessions without email while keeping staff, origin, CSRF and disabled-mode boundaries", async () => {
      const enabled = await client(true);
      const disabled = await client();
      const body = {
        email: "borrower@example.test",
        bankSlug: "bank-a",
        portal: "borrower",
        returnPath: "/",
      };
      const path = "/api/v1/auth/demo-sign-in";
      try {
        expect((await enabled.call("/api/v1/auth/session")).body).toEqual({
          authenticated: false,
          demoSignInEnabled: true,
          demoInboxEnabled: false,
        });
        expect((await disabled.call(path, { method: "POST", body })).status).toBe(503);
        expect((await enabled.call(path, { method: "POST", omitOrigin: true, body })).status).toBe(
          403,
        );
        expect(
          (await enabled.call(path, { method: "POST", origin: staffOrigin, body })).status,
        ).toBe(403);
        const before = await database.pool.query<{ count: string }>(
          "SELECT count(*) FROM access_delivery_requests",
        );
        const login = await enabled.call(path, { method: "POST", body });
        expect(login.status).toBe(200);
        const cookie = login.cookie.split(";")[0];
        const session = authSessionSchema.parse(
          (await enabled.call("/api/v1/auth/session", { cookie, omitOrigin: true })).body,
        );
        expect(session.authenticated).toBe(true);
        if (!session.authenticated) throw new Error("Expected synthetic demo session.");
        expect(session.authenticationMethod).toBe("demo");
        expect(session.demoSignInEnabled).toBe(true);
        expect(session.staff).toBe(false);
        expect((await enabled.call("/api/v1/auth/staff", { cookie })).status).toBe(404);
        const application = `/api/v1/banks/${seedIds.bankA}/applications/${seedIds.applicationSmall}`;
        expect((await enabled.call(application, { cookie })).status).toBe(200);
        expect((await disabled.call("/api/v1/auth/session", { cookie })).body).toEqual({
          authenticated: false,
          demoSignInEnabled: false,
          demoInboxEnabled: false,
        });
        expect((await disabled.call(application, { cookie })).status).toBe(404);
        expect((await enabled.call(path, { method: "POST", cookie, body })).status).toBe(403);
        expect(
          (
            await enabled.call("/api/v1/auth/logout", {
              method: "POST",
              cookie,
              csrf: session.csrfToken,
            })
          ).status,
        ).toBe(200);
        expect((await enabled.call("/api/v1/auth/session", { cookie })).body).toEqual({
          authenticated: false,
          demoSignInEnabled: true,
          demoInboxEnabled: false,
        });
        const staffLogin = await enabled.call(path, {
          method: "POST",
          origin: staffOrigin,
          body: { ...body, email: "officer-a@example.test", portal: "staff" },
        });
        expect(staffLogin.status).toBe(200);
        expect(
          (
            await enabled.call("/api/v1/auth/staff", {
              origin: staffOrigin,
              cookie: staffLogin.cookie.split(";")[0],
            })
          ).status,
        ).toBe(200);
        const deniedStaff = await enabled.call(path, {
          method: "POST",
          origin: staffOrigin,
          body: { ...body, portal: "staff" },
        });
        expect(deniedStaff.status).toBe(404);
        const after = await database.pool.query<{ count: string }>(
          "SELECT count(*) FROM access_delivery_requests",
        );
        expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
      } finally {
        await enabled.app.close();
        await disabled.app.close();
      }
    });

    it("uses real cookies, deliberate confirmation, current membership, CSRF and immediate revocation", async () => {
      const { app, call, requestLink } = await client();
      try {
        const link = await requestLink("borrower@example.test");
        expect((await call("/api/v1/auth/session")).body).toEqual({
          authenticated: false,
          demoSignInEnabled: false,
          demoInboxEnabled: false,
        });
        // Scanner GETs and origin changes cannot consume a credential.
        expect((await call("/api/v1/auth/consume")).status).toBe(404);
        expect(
          (
            await call("/api/v1/auth/consume", {
              method: "POST",
              origin: staffOrigin,
              body: { token: link.token },
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await call("/api/v1/auth/consume", {
              method: "POST",
              omitOrigin: true,
              body: { token: link.token },
            })
          ).status,
        ).toBe(403);
        const consumed = await call("/api/v1/auth/consume", {
          method: "POST",
          body: { token: link.token },
        });
        expect(consumed.status).toBe(200);
        expect(consumed.body).toEqual({ returnPath: "/" });
        expect(consumed.cookie.includes("HttpOnly")).toBe(true);
        expect(consumed.cookie.includes("SameSite=Lax")).toBe(true);
        const cookie = consumed.cookie.split(";")[0];
        const sessionReply = await call("/api/v1/auth/session", { cookie, omitOrigin: true });
        const session = authSessionSchema.parse(sessionReply.body);
        expect(session.authenticated).toBe(true);
        if (!session.authenticated) throw new Error("Expected authenticated session.");
        expect(session.bank.id).toBe(seedIds.bankA);
        expect(session.staff).toBe(false);
        expect((await call("/api/v1/auth/staff", { cookie })).status).toBe(404);
        expect((await call("/api/v1/auth/session", { cookie, origin: staffOrigin })).body).toEqual({
          authenticated: false,
          demoSignInEnabled: false,
          demoInboxEnabled: false,
        });
        const application = `/api/v1/banks/${seedIds.bankA}/applications/${seedIds.applicationSmall}`;
        expect((await call(application, { cookie })).status).toBe(200);
        expect(
          (await call(application.replace(seedIds.bankA, seedIds.bankB), { cookie })).status,
        ).toBe(404);
        expect(
          (
            await call(`${application}/purpose`, {
              method: "PATCH",
              cookie,
              body: { expectedRevision: 1, purpose: "Synthetic" },
            })
          ).status,
        ).toBe(403);
        expect((await call("/api/v1/auth/logout", { method: "POST", cookie })).status).toBe(403);
        expect(
          (await call("/api/v1/auth/logout", { method: "POST", cookie, csrf: session.csrfToken }))
            .status,
        ).toBe(200);
        expect((await call("/api/v1/auth/session", { cookie })).body).toEqual({
          authenticated: false,
          demoSignInEnabled: false,
          demoInboxEnabled: false,
        });
        expect((await call(application, { cookie })).status).toBe(404);
        expect(
          (await call("/api/v1/auth/consume", { method: "POST", body: { token: link.token } }))
            .status,
        ).toBe(400);

        const staffLink = await requestLink("officer-a@example.test", "staff");
        const staffLogin = await call("/api/v1/auth/consume", {
          method: "POST",
          origin: staffOrigin,
          body: { token: staffLink.token },
        });
        expect(staffLogin.status).toBe(200);
        const staffCookie = staffLogin.cookie.split(";")[0];
        expect(
          (await call("/api/v1/auth/staff", { cookie: staffCookie, origin: staffOrigin })).status,
        ).toBe(200);
        await database.pool.query(
          "UPDATE bank_memberships SET revoked_at = now() WHERE bank_id = $1 AND user_id = $2",
          [seedIds.bankA, seedIds.officerA],
        );
        expect(
          (await call("/api/v1/auth/staff", { cookie: staffCookie, origin: staffOrigin })).status,
        ).toBe(404);
        await database.pool.query(
          "UPDATE bank_memberships SET revoked_at = NULL WHERE bank_id = $1 AND user_id = $2",
          [seedIds.bankA, seedIds.officerA],
        );
      } finally {
        await app.close();
      }
    });

    it("does not enumerate identities, create applications, accept open redirects or trust the wrong portal", async () => {
      const { app, call, requestLink } = await client();
      try {
        const before = await database.pool.query<{ count: string }>(
          "SELECT count(*) FROM applications",
        );
        const first = await requestLink(`new-${randomUUID()}@example.test`);
        const second = await requestLink("borrower@example.test");
        expect(first.response.body).toEqual(second.response.body);
        for (const returnPath of [
          "https://evil.test",
          "//evil.test",
          "/auth/confirm",
          "/?next=https://evil.test",
        ]) {
          expect(
            (
              await call("/api/v1/auth/request-link", {
                method: "POST",
                ip: randomUUID(),
                body: {
                  email: "borrower@example.test",
                  bankSlug: "bank-a",
                  portal: "borrower",
                  returnPath,
                },
              })
            ).status,
          ).toBe(400);
        }
        expect(
          (
            await call("/api/v1/auth/request-link", {
              method: "POST",
              body: {
                email: "borrower@example.test",
                bankSlug: "bank-a",
                portal: "staff",
                returnPath: "/",
              },
            })
          ).status,
        ).toBe(403);
        const after = await database.pool.query<{ count: string }>(
          "SELECT count(*) FROM applications",
        );
        expect(before.rows[0]?.count).toBe(after.rows[0]?.count);
      } finally {
        await app.close();
      }
    });
  });
}
