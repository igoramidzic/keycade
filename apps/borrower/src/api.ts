import { authSessionSchema } from "@keycade/contracts";
import { currentSession, rememberSession } from "@keycade/ui/lib/session-snapshot";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  schema: { parse(input: unknown): T },
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: object;
    signal?: AbortSignal;
    bankId?: string;
    actorEmail?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let csrf: string | undefined;
  let expectedSession: string | undefined;
  if (method !== "GET" || options.bankId || options.actorEmail) {
    const session =
      currentSession() ??
      (await request("/api/v1/auth/session", authSessionSchema, { signal: options.signal }));
    if (!session.authenticated)
      throw new ApiError(
        "SESSION_EXPIRED",
        401,
        "Please sign in again. Your saved progress is safe.",
      );
    if (
      (options.bankId && session.bank.id !== options.bankId) ||
      (options.actorEmail && session.user.email !== options.actorEmail)
    )
      throw new ApiError(
        "SESSION_CHANGED",
        401,
        "Your sign-in changed. Return to your original account to continue.",
      );
    expectedSession = session.csrfToken;
    if (method !== "GET") csrf = session.csrfToken;
  }
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(expectedSession ? { "x-keycade-session": expectedSession } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data?.error?.code ?? "UNAVAILABLE",
      response.status,
      response.status === 404
        ? "This application is unavailable for your account."
        : (data?.error?.message ?? "We couldn’t complete your request. Please try again."),
    );
  // Native Worker builds can finish independently. Older APIs need the explicit post-check.
  if (expectedSession && response.headers.get("x-keycade-session-bound") !== "1") {
    const current = await request("/api/v1/auth/session", authSessionSchema, {
      signal: options.signal,
    });
    if (!current.authenticated || current.csrfToken !== expectedSession)
      throw new ApiError("SESSION_CHANGED", 401, "Your sign-in changed. Please sign in again.");
  }
  if (options.bankId || options.actorEmail) {
    const current = currentSession();
    if (
      !current?.authenticated ||
      current.csrfToken !== expectedSession ||
      (options.bankId && current.bank.id !== options.bankId) ||
      (options.actorEmail && current.user.email !== options.actorEmail)
    ) {
      throw new ApiError(
        "SESSION_CHANGED",
        401,
        "Your sign-in changed. Return to your original account to continue.",
      );
    }
  }
  const parsed = schema.parse(data);
  if (path === "/api/v1/auth/session") rememberSession(authSessionSchema.parse(parsed));
  return parsed;
}
export const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "We couldn’t connect. Your entered answer is still here. Please try again.";
export function formatAmount(amount: string) {
  const [whole, fraction] = amount.split(".");
  return `$${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === "00" ? "" : `.${fraction}`}`;
}
export function decimalAmount(value: string) {
  const clean = value.trim();
  if (!/^(?:[1-9]\d{0,17}|0)(?:\.\d{1,2})?$/.test(clean))
    throw new Error("Enter an amount using digits and up to two decimal places, such as 10000.");
  const [whole, fraction = ""] = clean.split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
  if (normalized === "0.00") throw new Error("Enter an amount greater than zero.");
  return normalized;
}
