import { describe, expect, it } from "vitest";
import { createDemoInboxCipher } from "./demo-inbox-cipher.js";

const scope = {
  bankId: "synthetic-bank",
  deliveryRequestId: "synthetic-delivery",
  loginTokenId: "synthetic-token",
  recipientEmail: "synthetic@example.test",
};
describe("synthetic inbox authenticated encryption", () => {
  it("randomizes ciphertext and binds the recipient, bank, delivery and token", () => {
    const cipher = createDemoInboxCipher("b".repeat(64));
    const value = "https://synthetic.example/auth/confirm#token=synthetic";
    const encrypted = cipher.encrypt(value, scope);
    expect(encrypted).not.toContain(value);
    expect(cipher.encrypt(value, scope)).not.toBe(encrypted);
    expect(cipher.decrypt(encrypted, scope)).toBe(value);
    for (const key of Object.keys(scope))
      expect(() => cipher.decrypt(encrypted, { ...scope, [key]: "changed" })).toThrow(
        "Stored demo message is unavailable.",
      );
  });
  it("rejects malformed keys, different keys and modified ciphertext with safe errors", () => {
    expect(() => createDemoInboxCipher("invalid")).toThrow(
      "Demo inbox encryption is not configured.",
    );
    const cipher = createDemoInboxCipher("b".repeat(64));
    const encrypted = cipher.encrypt("synthetic-secret", scope);
    expect(() => createDemoInboxCipher("c".repeat(64)).decrypt(encrypted, scope)).toThrow(
      "Stored demo message is unavailable.",
    );
    expect(() => cipher.decrypt(`${encrypted}.extra`, scope)).toThrow(
      "Stored demo message is unavailable.",
    );
  });
});
