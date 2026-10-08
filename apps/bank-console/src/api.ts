import { authSessionSchema } from "@keycade/contracts";
import type { AuthenticatedSession } from "@keycade/ui/components/identity-portal";
import { currentSession } from "@keycade/ui/lib/session-snapshot";
import { createContext, useContext } from "react";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type StaffApi = ReturnType<typeof createStaffApi>;
export const StaffApiContext = createContext<StaffApi | null>(null);
export function useStaffApi() {
  const api = useContext(StaffApiContext);
  if (!api) throw new Error("Staff workspace is missing.");
  return api;
}
export function createStaffApi(session: AuthenticatedSession, onDenied: () => void) {
  const bankBase = `/api/v1/banks/${session.bank.id}`;
  async function verify(signal?: AbortSignal) {
    const response = await fetch("/api/v1/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Session check unavailable.");
    const current = authSessionSchema.parse(await response.json());
    if (
      !current.authenticated ||
      !current.staff ||
      current.bank.id !== session.bank.id ||
      current.authenticationMethod !== session.authenticationMethod ||
      current.user.email !== session.user.email
    ) {
      onDenied();
      throw new ApiError(
        "SESSION_CHANGED",
        401,
        "Your staff session changed. Please sign in again.",
      );
    }
    return current;
  }
  async function send<T>(
    base: string,
    path: string,
    schema: { parse(value: unknown): T },
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: object;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        ...(options.method && options.method !== "GET"
          ? { "x-csrf-token": session.csrfToken }
          : {}),
        "x-keycade-session": session.csrfToken,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 401 || response.status === 403) onDenied();
    const data = await response.json();
    if (!response.ok)
      throw new ApiError(
        data?.error?.code ?? "UNAVAILABLE",
        response.status,
        response.status === 404
          ? "This application is unavailable for your staff account."
          : (data?.error?.message ?? "We couldn’t complete your request. Please try again."),
      );
    // A response started by an old account must never populate the current account's screen.
    // An older API may still serve traffic while the five native builds finish independently.
    if (response.headers.get("x-keycade-session-bound") !== "1") {
      const verified = await verify(signal);
      if (verified.csrfToken !== session.csrfToken) {
        onDenied();
        throw new ApiError(
          "SESSION_CHANGED",
          401,
          "Your staff session changed. Please sign in again.",
        );
      }
    }
    const current = currentSession();
    if (!current?.authenticated || current.csrfToken !== session.csrfToken) {
      onDenied();
      throw new ApiError(
        "SESSION_CHANGED",
        401,
        "Your staff session changed. Please sign in again.",
      );
    }
    return schema.parse(data);
  }
  const request: <T>(
    path: string,
    schema: { parse(value: unknown): T },
    options?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: object; signal?: AbortSignal },
  ) => Promise<T> = (path, schema, options) => send(`${bankBase}/staff`, path, schema, options);
  const participantRequest: typeof request = (path, schema, options) =>
    send(bankBase, path, schema, options);
  return { request, participantRequest, verify, bankBase, bankName: session.bank.name };
}
export function formatAmount(amount: string | null) {
  if (!amount) return "Not provided";
  const [whole, fraction] = amount.split(".");
  return `$${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === "00" ? "" : `.${fraction}`}`;
}
export function decimalAmount(value: string) {
  if (!/^(?:[1-9]\d{0,17}|0)(?:\.\d{1,2})?$/.test(value.trim()))
    throw new ApiError(
      "INVALID_AMOUNT",
      400,
      "Enter an amount using digits and up to two decimal places.",
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = `${whole}.${fraction.padEnd(2, "0")}`;
  if (amount === "0.00")
    throw new ApiError("INVALID_AMOUNT", 400, "Enter an amount greater than zero.");
  return amount;
}
