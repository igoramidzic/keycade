import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentifierCipher } from "./identifier-cipher.js";

const scope = {
  bankId: "bank-a",
  applicationId: "application-a",
  subjectKey: "business",
  revision: 1,
};
describe("private identifier encryption", () => {
  it("round trips synthetic values with random nonces and no plaintext", () => {
    const cipher = createIdentifierCipher(randomBytes(32).toString("hex"));
    const one = cipher.encrypt("000000001", scope);
    const two = cipher.encrypt("000000001", scope);
    expect(one).not.toBe(two);
    expect(one).not.toContain("000000001");
    expect(cipher.decrypt(one, scope)).toBe("000000001");
  });
  it("authenticates scope, revision, key and stored bytes", () => {
    const cipher = createIdentifierCipher("a".repeat(64));
    const encrypted = cipher.encrypt("000000002", scope);
    for (const changed of [
      { ...scope, bankId: "bank-b" },
      { ...scope, applicationId: "application-b" },
      { ...scope, subjectKey: "person" },
      { ...scope, revision: 2 },
    ])
      expect(() => cipher.decrypt(encrypted, changed)).toThrow("Stored identifier is unavailable.");
    expect(() => createIdentifierCipher("b".repeat(64)).decrypt(encrypted, scope)).toThrow(
      "Stored identifier is unavailable.",
    );
    expect(() => cipher.decrypt(`${encrypted.slice(0, -2)}xx`, scope)).toThrow(
      "Stored identifier is unavailable.",
    );
    expect(() => createIdentifierCipher("bad-key")).toThrow(
      "Identifier encryption is not configured.",
    );
  });
});
