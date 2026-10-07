import { timingSafeEqual } from "node:crypto";
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

// T06 applies these tighter per-route policies to authentication sends and consumes.
export const authRateLimit = { max: 5, timeWindow: "1 minute" } as const;
