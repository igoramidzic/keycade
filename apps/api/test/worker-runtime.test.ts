import { afterEach, expect, test, vi } from "vitest";
import worker from "../worker";

const borrowerOrigin = "https://keycade-borrower.kualia.workers.dev";
const staffOrigin = "https://keycade-bank-console.kualia.workers.dev";
const key = "73".repeat(32);

function bindings(demoInboxEnabled: string, encryptionKey = key) {
  // These tests deliberately make PostgreSQL unreachable: a disabled delivery adapter must
  // reject before creating a user, draft, or durable email intent.
  return {
    DOCUMENTS: {} as R2Bucket,
    HYPERDRIVE: {
      connectionString: "postgresql://unused:unused@127.0.0.1:1/unused",
    } as Hyperdrive,
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ALLOWED_ORIGINS: `https://keycade-bank-site.kualia.workers.dev,${borrowerOrigin},${staffOrigin}`,
    DEMO_INBOX_ENABLED: demoInboxEnabled,
    ENCRYPTION_KEY: encryptionKey,
    BORROWER_ORIGIN: borrowerOrigin,
    STAFF_ORIGIN: staffOrigin,
    JOBS: { fetch: vi.fn<Fetcher["fetch"]>(), connect: vi.fn<Fetcher["connect"]>() },
  } as ApiBindings;
}

async function call(env: ApiBindings, path: string, body?: object, origin = borrowerOrigin) {
  const waitUntil = vi.fn();
  const context = {} as ExecutionContext;
  context.waitUntil = waitUntil;
  const response = await worker.fetch(
    new Request(origin + path, {
      method: body ? "POST" : "GET",
      headers: { origin, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    context,
  );
  expect(waitUntil).not.toHaveBeenCalled();
  return { status: response.status, body: await response.json() };
}

afterEach(() => vi.restoreAllMocks());

test.each([
  { name: "disabled inbox", enabled: "false", encryptionKey: key },
  { name: "missing inbox flag", enabled: "", encryptionKey: key },
  { name: "missing encryption key", enabled: "true", encryptionKey: "" },
  { name: "invalid encryption key", enabled: "true", encryptionKey: "invalid" },
])(
  "native Worker rejects simulated delivery with $name before persisting intent",
  async (config) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const env = bindings(config.enabled, config.encryptionKey);
    for (const [origin, portal] of [
      [borrowerOrigin, "borrower"],
      [staffOrigin, "staff"],
    ] as const) {
      const response = await call(
        env,
        "/api/v1/auth/request-link",
        { email: "synthetic@example.test", bankSlug: "bank-a", portal, returnPath: "/" },
        origin,
      );
      expect(response).toMatchObject({
        status: 503,
        body: { error: { code: "AUTH_DELIVERY_UNAVAILABLE" } },
      });
    }
    expect(
      await call(env, "/api/v1/applications/start", {
        email: "synthetic@example.test",
        bankSlug: "bank-a",
        idempotencyKey: "12".repeat(32),
      }),
    ).toMatchObject({ status: 503, body: { error: { code: "AUTH_DELIVERY_UNAVAILABLE" } } });
    expect(await call(env, "/api/v1/auth/session")).toEqual({
      status: 200,
      body: { authenticated: false, demoSignInEnabled: true, demoInboxEnabled: false },
    });
    expect(await call(env, "/api/ready")).toMatchObject({
      status: 503,
      body: { status: "not_ready", simulation: true },
    });
    expect(env.JOBS.fetch).not.toHaveBeenCalled();
    expect(await call(env, "/api/health")).toEqual({
      status: 200,
      body: { status: "ok", simulation: true },
    });
  },
);

test("native Worker restores simulated delivery when the inbox configuration is valid", async () => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const env = bindings("true");
  expect(await call(env, "/api/v1/auth/session")).toEqual({
    status: 200,
    body: { authenticated: false, demoSignInEnabled: true, demoInboxEnabled: true },
  });
  // With delivery configured the same request reaches PostgreSQL, whose deliberate refusal
  // remains a safely retryable service failure rather than an adapter configuration failure.
  expect(
    await call(env, "/api/v1/auth/request-link", {
      email: "synthetic@example.test",
      bankSlug: "bank-a",
      portal: "borrower",
      returnPath: "/",
    }),
  ).toMatchObject({ status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } });
});
