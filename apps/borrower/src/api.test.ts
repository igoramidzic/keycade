import { rememberSession } from "@keycade/ui/lib/session-snapshot";
import { afterEach, expect, test, vi } from "vitest";
import { ApiError, onApplicationAccessLoss, request } from "./api";

const session = {
  authenticated: true as const,
  bank: { id: "00000000-0000-4000-8000-000000000001" },
  user: { email: "borrower@example.test" },
  csrfToken: "a".repeat(64),
};
const schema = { parse: (value: unknown) => value };

test("mutation access loss invalidates its exact application and unsubscribed editors stay untouched", async () => {
  rememberSession(session);
  const listener = vi.fn();
  const stop = onApplicationAccessLoss(listener);
  const path = `/api/v1/banks/${session.bank.id}/applications/application-a/tasks/task-a/answer`;
  const options = {
    bankId: session.bank.id,
    actorEmail: session.user.email,
    method: "PATCH" as const,
    body: { answer: "Synthetic" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: { code: "FORBIDDEN", message: "Access removed" } }, { status: 403 }),
    ),
  );
  try {
    await expect(request(path, schema, options)).rejects.toMatchObject({ status: 403 });
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      bankId: session.bank.id,
      actorEmail: session.user.email,
      applicationId: "application-a",
      error: expect.any(ApiError),
    });
  } finally {
    stop();
  }
  await expect(request(path, schema, options)).rejects.toMatchObject({ status: 403 });
  expect(listener).toHaveBeenCalledTimes(1);
});

test("temporary application failures preserve retained editing state", async () => {
  rememberSession(session);
  const listener = vi.fn();
  const stop = onApplicationAccessLoss(listener);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 })),
  );
  try {
    await expect(
      request(`/api/v1/banks/${session.bank.id}/applications/application-a/tasks`, schema, {
        bankId: session.bank.id,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(listener).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test.each([
  { suffix: "setup", method: "PATCH" },
  { suffix: "setup/identifier", method: "PATCH" },
  { suffix: "setup/finish", method: "POST" },
  { suffix: "setup", method: "GET" },
] as const)(
  "explicit setup recovery receives $method $suffix session errors without discarding its form",
  async ({ suffix, method }) => {
    rememberSession(session);
    const listener = vi.fn();
    const stop = onApplicationAccessLoss(listener);
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { code: "SESSION_CHANGED", message: "Sign in again." } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        request(`/api/v1/banks/${session.bank.id}/applications/application-a/${suffix}`, schema, {
          bankId: session.bank.id,
          actorEmail: session.user.email,
          recoverSetupSession: true,
          method,
        }),
      ).rejects.toMatchObject({ code: "SESSION_CHANGED", status: 401 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

test.each(["expired", "changed"] as const)(
  "setup recovery never sends a save from a locally %s identity",
  async (state) => {
    rememberSession(
      state === "expired"
        ? { authenticated: false }
        : { ...session, user: { email: "another@example.test" } },
    );
    const listener = vi.fn();
    const stop = onApplicationAccessLoss(listener);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        request(`/api/v1/banks/${session.bank.id}/applications/application-a/setup`, schema, {
          bankId: session.bank.id,
          actorEmail: session.user.email,
          recoverSetupSession: true,
          method: "PATCH",
          body: { requestedAmount: "37500.00" },
        }),
      ).rejects.toMatchObject({
        code: state === "expired" ? "SESSION_EXPIRED" : "SESSION_CHANGED",
        status: 401,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

test.each([
  { suffix: "setup", status: 403, code: "FORBIDDEN", recoverSetupSession: true },
  { suffix: "setup", status: 404, code: "NOT_FOUND", recoverSetupSession: true },
  { suffix: "setup", status: 401, code: "OTHER_DENIAL", recoverSetupSession: true },
  { suffix: "tasks", status: 401, code: "SESSION_CHANGED", recoverSetupSession: true },
  { suffix: "setup", status: 401, code: "SESSION_CHANGED", recoverSetupSession: false },
])(
  "$suffix $status $code still clears application caches when recovery is $recoverSetupSession",
  async ({ suffix, status, code, recoverSetupSession }) => {
    rememberSession(session);
    const listener = vi.fn();
    const stop = onApplicationAccessLoss(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code } }, { status })),
    );
    try {
      await expect(
        request(`/api/v1/banks/${session.bank.id}/applications/application-a/${suffix}`, schema, {
          bankId: session.bank.id,
          actorEmail: session.user.email,
          recoverSetupSession,
          method: "PATCH",
        }),
      ).rejects.toMatchObject({ code, status });
      expect(listener).toHaveBeenCalledExactlyOnceWith({
        bankId: session.bank.id,
        applicationId: "application-a",
        actorEmail: session.user.email,
        error: expect.any(ApiError),
      });
    } finally {
      stop();
    }
  },
);
afterEach(() => {
  vi.unstubAllGlobals();
  rememberSession({ authenticated: false });
});

test("protected reads and saves each make one request bound to the mounted session", async () => {
  rememberSession(session);
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) =>
    Response.json({ saved: true }, { headers: { "x-keycade-session-bound": "1" } }),
  );
  vi.stubGlobal("fetch", fetch);
  const actor = { bankId: session.bank.id, actorEmail: session.user.email };
  await request("/tasks", schema, actor);
  await request("/tasks/answer", schema, {
    ...actor,
    method: "PATCH",
    body: { answer: "Synthetic" },
  });
  expect(fetch.mock.calls).toHaveLength(2);
  const calls = fetch.mock.calls;
  expect(calls[0]?.[0]).toBe("/tasks");
  expect(calls[0]?.[1]?.headers).toMatchObject({ "x-keycade-session": session.csrfToken });
  expect(calls[1]?.[1]?.headers).toMatchObject({
    "x-csrf-token": session.csrfToken,
    "x-keycade-session": session.csrfToken,
  });
});

test("a late response cannot populate a locally changed session", async () => {
  rememberSession(session);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      rememberSession({ ...session, csrfToken: "b".repeat(64) });
      return Response.json({ oldAccount: true }, { headers: { "x-keycade-session-bound": "1" } });
    }),
  );
  await expect(request("/tasks", schema, { bankId: session.bank.id })).rejects.toMatchObject({
    code: "SESSION_CHANGED",
    status: 401,
  });
});

test("a different actor is rejected before sending and server session rejection propagates", async () => {
  rememberSession(session);
  const fetch = vi.fn(async () =>
    Response.json(
      { error: { code: "SESSION_CHANGED", message: "Sign in again." } },
      { status: 401 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    request("/tasks", schema, { actorEmail: "another@example.test" }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(fetch).not.toHaveBeenCalled();
  await expect(request("/tasks", schema, { bankId: session.bank.id })).rejects.toMatchObject({
    code: "SESSION_CHANGED",
    status: 401,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an older API requires a session post-check and cannot return a switched account during rollout", async () => {
  rememberSession(session);
  const fetch = vi.fn(async (path: string) =>
    path === "/api/v1/auth/session"
      ? Response.json({
          ...session,
          csrfToken: "b".repeat(64),
          demoSignInEnabled: true,
          staff: false,
          authenticationMethod: "demo",
          bank: { ...session.bank, slug: "bank-a", name: "Synthetic Bank A" },
          user: { ...session.user, displayName: null },
        })
      : Response.json({ saved: true }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(request("/tasks", schema, { bankId: session.bank.id })).rejects.toMatchObject({
    code: "SESSION_CHANGED",
    status: 401,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/v1/auth/session");
});
