import { authSessionSchema } from "@keycade/contracts";

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
    method?: "GET" | "POST" | "PATCH";
    body?: object;
    signal?: AbortSignal;
    bankId?: string;
    actorEmail?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let csrf: string | undefined;
  if (method !== "GET" || options.bankId || options.actorEmail) {
    const session = await request("/api/v1/auth/session", authSessionSchema);
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
  return schema.parse(data);
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
