import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface IdentifierScope {
  bankId: string;
  applicationId: string;
  subjectKey: string;
  revision: number;
}
export interface IdentifierCipher {
  encrypt(value: string, scope: IdentifierScope): string;
  decrypt(encrypted: string, scope: IdentifierScope): string;
}
const aad = (scope: IdentifierScope) =>
  Buffer.from(
    JSON.stringify([
      "keycade-identifier-v1",
      scope.bankId,
      scope.applicationId,
      scope.subjectKey,
      scope.revision,
    ]),
  );

/** Server-only authenticated encryption. The raw value never leaves the provider boundary. */
export function createIdentifierCipher(keyHex: string): IdentifierCipher {
  if (!/^[a-f0-9]{64}$/.test(keyHex)) throw new Error("Identifier encryption is not configured.");
  const key = Buffer.from(keyHex, "hex");
  return {
    encrypt(value, scope) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(scope));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return [
        "v1",
        Buffer.from(iv).toString("base64url"),
        Buffer.from(cipher.getAuthTag()).toString("base64url"),
        ciphertext.toString("base64url"),
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
        throw new Error("Stored identifier is unavailable.");
      }
    },
  };
}
