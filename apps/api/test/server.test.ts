import { randomUUID } from "node:crypto";
import { publicApplicationSchema, staffApplicationSchema } from "@keycade/contracts";
import { createDatabase } from "@keycade/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildServer } from "../src/server.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function server() {
  const { db, pool } = createDatabase("postgresql://unused:unused@127.0.0.1:1/unused");
  const app = await buildServer({
    db,
    allowedOrigins: ["http://localhost:3001"],
    readiness: async () => {
      throw new Error("secret database URL");
    },
  });
  cleanups.push(
    () => app.close(),
    () => pool.end(),
  );
  return app;
}

describe("HTTP foundation", () => {
  it("keeps liveness available while database readiness fails safely", async () => {
    const app = await server();
    expect((await app.inject("/api/health")).json()).toEqual({ status: "ok", simulation: true });
    const ready = await app.inject("/api/ready");
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "not_ready",
      database: "unavailable",
      worker: "unavailable",
      simulation: true,
    });
    expect(ready.body).not.toContain("secret");
  });
  it("keeps diagnostics independent of a failed session resolver", async () => {
    const { db, pool } = createDatabase("postgresql://unused:unused@127.0.0.1:1/unused");
    const app = await buildServer({
      db,
      allowedOrigins: [],
      authenticate: async () => {
        throw new Error("Session database unavailable");
      },
      readiness: async () => ({
        status: "not_ready",
        database: "unavailable",
        worker: "unavailable",
        simulation: true,
      }),
    });
    cleanups.push(
      () => app.close(),
      () => pool.end(),
    );
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/api/ready")).statusCode).toBe(503);
  });
  it("returns stable malformed-input errors and generates its own request IDs", async () => {
    const app = await server();
    const reply = await app.inject({
      url: "/api/v1/banks/invalid/applications/invalid",
      headers: { "x-request-id": "unsafe incoming id" },
    });
    expect(reply.statusCode).toBe(400);
    expect(reply.json()).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request.",
        requestId: reply.headers["x-request-id"],
      },
    });
    expect(z.string().uuid().safeParse(reply.headers["x-request-id"]).success).toBe(true);
  });
  it("has no public actor injection or record-existence oracle", async () => {
    const app = await server();
    const reply = await app.inject({
      url: `/api/v1/banks/${randomUUID()}/applications/${randomUUID()}`,
      headers: { "x-user-id": randomUUID(), "x-bank-role": "admin" },
    });
    expect(reply.statusCode).toBe(404);
    expect(reply.json().error.code).toBe("NOT_FOUND");
  });
  it("blocks unsafe origins before executing writes", async () => {
    const app = await server();
    const reply = await app.inject({
      method: "PATCH",
      url: `/api/v1/banks/${randomUUID()}/applications/${randomUUID()}/purpose`,
      headers: { origin: "http://evil.test" },
      payload: { expectedRevision: 1, purpose: "Synthetic" },
    });
    expect(reply.statusCode).toBe(403);
  });
  it("response schemas drop internal fields and distinguish staff DTOs", async () => {
    const app = await server();
    const row = {
      id: randomUUID(),
      bankId: randomUUID(),
      productId: null,
      status: "draft",
      requestedAmount: "10000.00",
      currency: "USD",
      purpose: null,
      revision: 1,
      assignedStaffId: null,
      source: "seed",
      createdByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      internalNotes: "private",
      sessionToken: "secret",
      ein: "synthetic secret",
    } as const;
    app.get(
      "/__test/public",
      { schema: { response: { 200: publicApplicationSchema } } },
      async () => row,
    );
    app.get(
      "/__test/staff",
      { schema: { response: { 200: staffApplicationSchema } } },
      async () => row,
    );
    const reply = await app.inject("/__test/public");
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).not.toHaveProperty("source");
    expect(reply.body).not.toMatch(/private|secret|ein|createdByUserId/);
    const staff = await app.inject("/__test/staff");
    expect(staff.json().source).toBe("seed");
    expect(staff.body).not.toMatch(/private|secret|ein/);
  });
  it("returns a stable rate-limit error with a request ID", async () => {
    const app = await server();
    const url = `/api/v1/banks/${randomUUID()}/applications/${randomUUID()}`;
    for (let count = 0; count < 120; count += 1) await app.inject(url);
    const limited = await app.inject(url);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again later.",
        requestId: limited.headers["x-request-id"],
      },
    });
    expect((await app.inject("/api/health")).statusCode).toBe(200);
  });
  it("sanitizes unexpected production errors and publishes validated OpenAPI routes", async () => {
    const app = await server();
    app.get("/__test/error", async () => {
      throw new Error("credential/stack secret");
    });
    const reply = await app.inject("/__test/error");
    expect(reply.statusCode).toBe(500);
    expect(reply.json().error.code).toBe("INTERNAL_ERROR");
    expect(reply.body).not.toMatch(/credential|stack|secret/);
    const spec = (await app.inject("/api/openapi.json")).json();
    expect(spec.paths["/api/v1/banks/{bankId}/applications/{applicationId}"]).toHaveProperty("get");
  });
});
