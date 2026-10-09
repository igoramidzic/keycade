import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { rememberSession } from "@keycade/ui/lib/session-snapshot";
import { afterEach, expect, test, vi } from "vitest";
import { createStaffApi } from "./api";

const session: AuthenticatedSession = {
  authenticated: true,
  demoSignInEnabled: true,
  bank: { id: "00000000-0000-4000-8000-000000000001", slug: "bank-a", name: "Synthetic Bank A" },
  user: { email: "officer-a@example.test", displayName: "Synthetic officer" },
  csrfToken: "a".repeat(64),
  staff: true,
  authenticationMethod: "demo",
};
const schema = { parse: (value: unknown) => value };
afterEach(() => {
  vi.unstubAllGlobals();
  rememberSession({ authenticated: false });
});

test("staff reads and saves each use one server-verified session-bound request", async () => {
  rememberSession(session);
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) =>
    Response.json({ ok: true }, { headers: { "x-keycade-session-bound": "1" } }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = createStaffApi(session, vi.fn());
  await api.request("/options", schema);
  await api.participantRequest("/tasks/answer", schema, { method: "PATCH", body: {} });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
    "x-keycade-session": session.csrfToken,
  });
  expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
    "x-keycade-session": session.csrfToken,
    "x-csrf-token": session.csrfToken,
  });
});

test("staff responses are discarded if the local identity changes while loading", async () => {
  rememberSession(session);
  const denied = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      rememberSession({ authenticated: false });
      return Response.json({ ok: true }, { headers: { "x-keycade-session-bound": "1" } });
    }),
  );
  await expect(createStaffApi(session, denied).request("/options", schema)).rejects.toMatchObject({
    code: "SESSION_CHANGED",
    status: 401,
  });
  expect(denied).toHaveBeenCalledOnce();
});

test("server session binding rejection clears the staff workspace without another session fetch", async () => {
  rememberSession(session);
  const denied = vi.fn();
  const fetch = vi.fn(async () =>
    Response.json(
      { error: { code: "SESSION_CHANGED", message: "Sign in again." } },
      { status: 401 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(createStaffApi(session, denied).request("/options", schema)).rejects.toMatchObject({
    status: 401,
  });
  expect(denied).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

test("an older API still verifies the session during a mixed-version rollout", async () => {
  rememberSession(session);
  const denied = vi.fn();
  const fetch = vi.fn(async (path: string) =>
    path === "/api/v1/auth/session"
      ? Response.json({ ...session, csrfToken: "b".repeat(64) })
      : Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(createStaffApi(session, denied).request("/options", schema)).rejects.toMatchObject({
    code: "SESSION_CHANGED",
    status: 401,
  });
  expect(denied).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  { ...session, staff: false },
  { ...session, csrfToken: "b".repeat(64) },
  { authenticated: false, demoSignInEnabled: true },
])("focus verification rejects revoked or replaced staff sessions", async (current) => {
  rememberSession(session);
  const denied = vi.fn();
  const fetch = vi.fn(async () => Response.json(current));
  vi.stubGlobal("fetch", fetch);
  await expect(createStaffApi(session, denied).verify()).rejects.toMatchObject({
    code: "SESSION_CHANGED",
  });
  expect(denied).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});
