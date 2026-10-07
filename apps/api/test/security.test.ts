import { describe, expect, it } from "vitest";
import {
  isAllowedOrigin,
  safeReturnUrl,
  sessionCookieOptions,
  validCsrfToken,
} from "../src/security.js";

describe("authentication security hooks", () => {
  const origin = "http://localhost:3001";
  it("accepts only exact configured origins", () => {
    expect(isAllowedOrigin(origin, [origin])).toBe(true);
    expect(isAllowedOrigin(undefined, [origin])).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001.evil.test", [origin])).toBe(false);
  });
  it("rejects missing, short and incorrect CSRF tokens", () => {
    const token = "a".repeat(32);
    expect(validCsrfToken(token, token)).toBe(true);
    expect(validCsrfToken(undefined, token)).toBe(false);
    expect(validCsrfToken("a", "a")).toBe(false);
    expect(validCsrfToken("b".repeat(32), token)).toBe(false);
    expect(validCsrfToken([token], token)).toBe(false);
  });
  it("restricts return destinations and credential-bearing URLs", () => {
    expect(safeReturnUrl("/applications", origin, [origin])).toBe(`${origin}/applications`);
    for (const value of [
      "//evil.test",
      "https://evil.test",
      "javascript:alert(1)",
      "http://user:pass@localhost:3001/",
      "/\\evil.test",
      "/\nevil",
    ]) {
      expect(safeReturnUrl(value, origin, [origin])).toBeNull();
    }
  });
  it("secures session cookies outside local development", () => {
    expect(sessionCookieOptions("production")).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    expect(sessionCookieOptions("development").secure).toBe(false);
  });
});
