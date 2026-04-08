import { getLogger } from "../../lib/logger.js";
import type { CryptoAdapter } from "./types.js";

export function createConsoleCryptoAdapter(): CryptoAdapter {
  return {
    async encrypt(plaintext) {
      getLogger().info(
        { length: plaintext.length },
        "Encrypt requested (console adapter — plaintext returned unchanged)",
      );
      return plaintext;
    },

    async decrypt(ciphertext) {
      getLogger().info(
        { length: ciphertext.length },
        "Decrypt requested (console adapter — ciphertext returned unchanged)",
      );
      return ciphertext;
    },
  };
}
