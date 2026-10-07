import { createHash, timingSafeEqual } from "node:crypto";
import type { CookieSerializeOptions } from "@fastify/cookie";

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  return origin !== undefined && allowedOrigins.includes(origin);
}

export function validCsrfToken(received: unknown, expected: string | undefined): boolean {
  if (typeof received !== "string" || !expected || expected.length < 32) return false;
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function sessionCookieOptions(nodeEnv: string): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: nodeEnv !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  };
}

// Resolve only trusted, explicitly configured destinations; never an arbitrary Host header.
export function safeReturnUrl(
  value: string,
  defaultOrigin: string,
  allowedOrigins: readonly string[],
): string | null {
  try {
    if (
      value.startsWith("//") ||
      value.includes("\\") ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32)
    )
      return null;
    const target = new URL(value, defaultOrigin);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      !allowedOrigins.includes(target.origin)
    )
      return null;
    return target.href;
  } catch {
    return null;
  }
}

// Shared PostgreSQL limits also cap sends per address/IP and consume attempts per IP.
export const authSendRateLimit = { max: 20, timeWindow: "1 minute" } as const;
export const authConsumeRateLimit = { max: 30, timeWindow: "1 minute" } as const;

// Cookies do not distinguish ports. Give each configured portal its own cookie so local
// borrower and staff sessions can coexist without replacing one another.
export function sessionCookieName(origin: string): string {
  return `keycade_session_${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`;
}

export function readSessionCookie(header: string | undefined, origin: string): string | undefined {
  const name = sessionCookieName(origin);
  const values = (header ?? "").split(";").map((part) => part.trim());
  const matches = values.filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(name.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export function serializeSessionCookie(origin: string, token: string, nodeEnv: string): string {
  const options = sessionCookieOptions(nodeEnv);
  return `${sessionCookieName(origin)}=${token}; Path=/; Max-Age=${token ? options.maxAge : 0}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`;
}

/** Mutations use Origin exclusively. GETs may omit it; their URL must match configuration. */
export function configuredRequestOrigin(
  origin: string | undefined,
  requestOrigin: string,
  allowedOrigins: readonly string[],
): string | undefined {
  const candidate = origin ?? requestOrigin;
  return isAllowedOrigin(candidate, allowedOrigins) ? candidate : undefined;
}
