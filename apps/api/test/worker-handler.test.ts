import { createDatabase } from "@keycade/db";
import { afterAll, expect, test } from "vitest";
import { handleWorkerRequest } from "../src/worker-handler";

const { db, pool } = createDatabase("postgresql://unused:unused@127.0.0.1:1/unused");
afterAll(() => pool.end());
const deps = {
  db,
  allowedOrigins: ["https://borrower.example"],
  rateLimiter: { limit: async () => ({ success: true }) },
  readiness: async () => {
    throw new Error("confidential database credential");
  },
};
const application =
  "/api/v1/banks/00000000-0000-4000-8000-000000000001/applications/00000000-0000-4000-8000-000000000002";
const request = (path: string, init?: RequestInit) =>
  new Request("https://api.example" + path, init);

test("Worker liveness stays available when readiness fails without leaking credentials", async () => {
  expect(await (await handleWorkerRequest(request("/api/health"), deps)).json()).toEqual({
    status: "ok",
    simulation: true,
  });
  const ready = await handleWorkerRequest(request("/api/ready"), deps);
  expect(ready.status).toBe(503);
  expect(await ready.text()).not.toContain("confidential");
  expect(
    (await handleWorkerRequest(request("/api/health", { method: "HEAD" }), deps)).body,
  ).toBeNull();
});
test("Worker transport preserves no-existence-oracle authorization and ignores claimed identity", async () => {
  for (const path of [application, application.replace("/applications/", "/staff/applications/")]) {
    const response = await handleWorkerRequest(
      request(path, { headers: { "x-user-id": "admin", "x-bank-role": "admin" } }),
      deps,
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  }
});
test("Worker rejects unsafe origins, malformed parameters, and streaming bodies above the limit", async () => {
  const options = {
    method: "PATCH",
    headers: { origin: "https://borrower.example", "content-type": "application/json" },
  };
  expect(
    (
      await handleWorkerRequest(
        request(application + "/purpose", {
          ...options,
          headers: { ...options.headers, origin: "https://untrusted.example" },
          body: "{}",
        }),
        deps,
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleWorkerRequest(request("/api/v1/banks/invalid/applications/invalid"), deps)).status,
  ).toBe(400);
  expect(
    (
      await handleWorkerRequest(
        request(application + "/purpose", { ...options, body: "x".repeat(65537) }),
        deps,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await handleWorkerRequest(
        request(application + "/purpose", { ...options, body: "not json" }),
        deps,
      )
    ).status,
  ).toBe(400);
});
test("Worker rate limits apply to requests while liveness remains available", async () => {
  const limited = { ...deps, rateLimiter: { limit: async () => ({ success: false }) } };
  expect((await handleWorkerRequest(request(application), limited)).status).toBe(429);
  expect((await handleWorkerRequest(request("/api/health"), limited)).status).toBe(200);
});
test("Worker publishes the same public application contract without administrative fields", async () => {
  const response = await handleWorkerRequest(request("/api/openapi.json"), deps);
  const document = await response.text();
  expect(response.status).toBe(200);
  expect(document).toContain('"openapi":"3.1.0"');
  expect(document).toContain('"expectedRevision"');
  expect(document).toContain('"/api/v1/applications/start"');
  expect(document).toContain('"/api/v1/banks/{bankId}/applications/{applicationId}/setup/finish"');
  expect(document).not.toContain("DATABASE_URL");
});

test("Worker identity diagnostics do not authenticate public headers and reject unsafe login mutations", async () => {
  expect(
    await (
      await handleWorkerRequest(
        request("/api/v1/auth/session", {
          headers: { "x-user-id": "admin", "x-bank-role": "admin" },
        }),
        deps,
      )
    ).json(),
  ).toEqual({ authenticated: false, demoSignInEnabled: false });
  expect((await handleWorkerRequest(request("/api/v1/auth/staff"), deps)).status).toBe(404);
  expect((await handleWorkerRequest(request("/api/v1/auth/consume"), deps)).status).toBe(404);
  expect(
    (
      await handleWorkerRequest(
        request("/api/v1/auth/request-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        deps,
      )
    ).status,
  ).toBe(403);
});

test("Worker explicitly reports unavailable hosted email and enforces CSRF for authenticated mutations", async () => {
  const unavailable = await handleWorkerRequest(
    request("/api/v1/auth/request-link", {
      method: "POST",
      headers: { origin: "https://borrower.example", "content-type": "application/json" },
      body: JSON.stringify({
        email: "borrower@example.test",
        bankSlug: "bank-a",
        portal: "borrower",
        returnPath: "/",
      }),
    }),
    { ...deps, authDeliveryEnabled: false },
  );
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).toContain("AUTH_DELIVERY_UNAVAILABLE");
  for (const path of [
    "/api/v1/auth/logout",
    "/api/v1/auth/demo-sign-in",
    "/api/v1/auth/request-link",
    "/api/v1/auth/consume",
    "/api/v1/applications/start",
    application + "/claim",
    application + "/setup/finish",
    application + "/setup",
    application + "/purpose",
  ]) {
    const denied = await handleWorkerRequest(
      request(path, {
        method: path.endsWith("purpose") || path.endsWith("setup") ? "PATCH" : "POST",
        headers: { origin: "https://borrower.example", "content-type": "application/json" },
        body: "{}",
      }),
      {
        ...deps,
        authenticate: async () => ({
          actor: { kind: "user", userId: "test" },
          csrfToken: "a".repeat(64),
        }),
      },
    );
    expect(denied.status).toBe(403);
  }
});

test("Worker immediate demo sign-in is unavailable by default", async () => {
  const response = await handleWorkerRequest(
    request("/api/v1/auth/demo-sign-in", {
      method: "POST",
      headers: { origin: "https://borrower.example", "content-type": "application/json" },
      body: JSON.stringify({
        email: "borrower@example.test",
        bankSlug: "bank-a",
        portal: "borrower",
        returnPath: "/",
      }),
    }),
    deps,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("DEMO_SIGN_IN_UNAVAILABLE");
});
