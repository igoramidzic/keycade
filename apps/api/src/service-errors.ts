// Only structured availability codes are recognized. Database errors can contain
// query parameters and credentials, so never inspect or return their messages.
const unavailableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

export const serviceUnavailableMessage =
  "The service is temporarily unavailable. Please try again in a moment.";

/** Drizzle wraps driver failures in cause; Node may aggregate connection attempts. */
export function isServiceUnavailable(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const failure = current as { code?: unknown; cause?: unknown };
    if (typeof failure.code === "string" && unavailableCodes.has(failure.code)) return true;
    if (failure.cause) pending.push(failure.cause);
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return false;
}
