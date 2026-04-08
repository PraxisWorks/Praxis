import { getLogger } from "../../lib/logger.js";
import type { CryptoAdapter } from "./types.js";
import { createConsoleCryptoAdapter } from "./console.js";
import { createAes256GcmAdapter } from "./aes256gcm.js";

export type { CryptoAdapter } from "./types.js";
export { createAes256GcmAdapter } from "./aes256gcm.js";
export { createConsoleCryptoAdapter } from "./console.js";

let instance: CryptoAdapter | null = null;

export function getCryptoAdapter(): CryptoAdapter {
  if (instance) return instance;

  const encryptionKey = process.env.API_KEY_ENCRYPTION_KEY;

  if (encryptionKey) {
    getLogger().info("Crypto adapter: AES-256-GCM");
    instance = createAes256GcmAdapter({ encryptionKey });
  } else {
    getLogger().info(
      "Crypto adapter: console (no API_KEY_ENCRYPTION_KEY set)",
    );
    instance = createConsoleCryptoAdapter();
  }

  return instance;
}

export function setCryptoAdapter(adapter: CryptoAdapter): void {
  instance = adapter;
}

export function resetCryptoAdapter(): void {
  instance = null;
}
