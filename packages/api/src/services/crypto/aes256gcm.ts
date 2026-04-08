import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { CryptoAdapter } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function createAes256GcmAdapter(config: {
  encryptionKey: string;
}): CryptoAdapter {
  const { encryptionKey } = config;

  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      "encryptionKey must be a 64-character hex string (32 bytes)",
    );
  }

  const keyBuffer = Buffer.from(encryptionKey, "hex");

  return {
    async encrypt(plaintext: string): Promise<string> {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      const combined = Buffer.concat([iv, encrypted, authTag]);
      return combined.toString("base64");
    },

    async decrypt(ciphertext: string): Promise<string> {
      const combined = Buffer.from(ciphertext, "base64");

      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
      const encrypted = combined.subarray(
        IV_LENGTH,
        combined.length - AUTH_TAG_LENGTH,
      );

      const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    },
  };
}
