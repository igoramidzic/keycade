import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface DemoInboxScope {
  bankId: string;
  deliveryRequestId: string;
  loginTokenId: string;
  recipientEmail: string;
}
export interface DemoInboxCipher {
  encrypt(value: string, scope: DemoInboxScope): string;
  decrypt(encrypted: string, scope: DemoInboxScope): string;
}
const aad = (scope: DemoInboxScope) =>
  Buffer.from(
    JSON.stringify([
      "keycade-demo-inbox-v1",
      scope.bankId,
      scope.deliveryRequestId,
      scope.loginTokenId,
      scope.recipientEmail,
    ]),
  );

/** Synthetic email links are recoverable only through the recipient-scoped inbox boundary. */
export function createDemoInboxCipher(keyHex: string): DemoInboxCipher {
  if (!/^[a-f0-9]{64}$/.test(keyHex)) throw new Error("Demo inbox encryption is not configured.");
  const key = createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update("keycade-demo-inbox-encryption-v1")
    .digest();
  return {
    encrypt(value, scope) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(scope));
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return [
        "v1",
        Buffer.from(iv).toString("base64url"),
        Buffer.from(cipher.getAuthTag()).toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    decrypt(encrypted, scope) {
      try {
        const [version, iv, tag, value, extra] = encrypted.split(".");
        if (version !== "v1" || !iv || !tag || !value || extra) throw new Error();
        const ivBytes = Buffer.from(iv, "base64url");
        const tagBytes = Buffer.from(tag, "base64url");
        if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, ivBytes);
        decipher.setAAD(aad(scope));
        decipher.setAuthTag(tagBytes);
        return Buffer.concat([
          decipher.update(Buffer.from(value, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("Stored demo message is unavailable.");
      }
    },
  };
}
