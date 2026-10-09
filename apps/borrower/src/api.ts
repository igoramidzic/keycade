import { authSessionSchema } from "@keycade/contracts";
import { currentSession, rememberSession } from "@keycade/ui/lib/session-snapshot";
import { workflowText } from "@keycade/ui/lib/workflow-text";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(workflowText(message));
  }
}
type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: object;
  signal?: AbortSignal;
  bankId?: string;
  actorEmail?: string;
  /** The setup form owns explicit sign-in recovery; all grant denials still clear it. */
  recoverSetupSession?: boolean;
};
type AccessLoss = { bankId: string; applicationId: string; actorEmail?: string; error: ApiError };
const accessListeners = new Set<(event: AccessLoss) => void>();
export function onApplicationAccessLoss(listener: (event: AccessLoss) => void) {
  accessListeners.add(listener);
  return () => {
    accessListeners.delete(listener);
  };
}
export function reportApplicationAccessLoss(path: string, options: RequestOptions, error: unknown) {
  if (!(error instanceof ApiError) || ![401, 403, 404].includes(error.status)) return;
  const match = /^\/api\/v1\/banks\/([^/]+)\/applications\/([^/?]+)(?:[/?]|$)/.exec(path);
  if (!match?.[1] || !match[2]) return;
  if (
    options.recoverSetupSession &&
    options.bankId === match[1] &&
    options.actorEmail &&
    error.status === 401 &&
    ["SESSION_EXPIRED", "SESSION_CHANGED"].includes(error.code) &&
    /^\/api\/v1\/banks\/[^/]+\/applications\/[^/]+\/setup(?:\/(?:identifier|finish))?$/.test(path)
  )
    return;
  for (const listener of accessListeners)
    listener({ bankId: match[1], applicationId: match[2], actorEmail: options.actorEmail, error });
}
export async function request<T>(
  path: string,
  schema: { parse(input: unknown): T },
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await performRequest(path, schema, options);
  } catch (error) {
    // Mutations are not query-cache errors. Notify the mounted application too,
    // so an access denial clears every retained editor immediately.
    reportApplicationAccessLoss(path, options, error);
    throw error;
  }
}
async function performRequest<T>(
  path: string,
  schema: { parse(input: unknown): T },
  options: RequestOptions,
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
