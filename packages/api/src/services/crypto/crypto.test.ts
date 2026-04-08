import { randomBytes } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { createAes256GcmAdapter } from "./aes256gcm.js";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn() })),
}));

import { createConsoleCryptoAdapter } from "./console.js";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

describe("AES-256-GCM adapter", () => {
  it("round-trips: decrypt(encrypt(x)) === x", async () => {
    const adapter = createAes256GcmAdapter({ encryptionKey: randomHexKey() });
    const plaintext = "hello, world!";
    const encrypted = await adapter.encrypt(plaintext);
    const decrypted = await adapter.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces unique IVs per call (same input yields different ciphertext)", async () => {
    const adapter = createAes256GcmAdapter({ encryptionKey: randomHexKey() });
    const plaintext = "same input";
    const a = await adapter.encrypt(plaintext);
    const b = await adapter.encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("handles empty string", async () => {
    const adapter = createAes256GcmAdapter({ encryptionKey: randomHexKey() });
    const encrypted = await adapter.encrypt("");
    const decrypted = await adapter.decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles long strings", async () => {
    const adapter = createAes256GcmAdapter({ encryptionKey: randomHexKey() });
    const plaintext = "a".repeat(100_000);
    const encrypted = await adapter.encrypt(plaintext);
    const decrypted = await adapter.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("throws if key is not 64 hex characters", () => {
    expect(() =>
      createAes256GcmAdapter({ encryptionKey: "too-short" }),
    ).toThrow("encryptionKey must be a 64-character hex string (32 bytes)");
  });

  it("throws if key has non-hex characters", () => {
    const badKey = "g".repeat(64);
    expect(() =>
      createAes256GcmAdapter({ encryptionKey: badKey }),
    ).toThrow("encryptionKey must be a 64-character hex string (32 bytes)");
  });
});

describe("Console crypto adapter", () => {
  it("encrypt returns input unchanged", async () => {
    const adapter = createConsoleCryptoAdapter();
    const input = "some secret";
    expect(await adapter.encrypt(input)).toBe(input);
  });

  it("decrypt returns input unchanged", async () => {
    const adapter = createConsoleCryptoAdapter();
    const input = "some ciphertext";
    expect(await adapter.decrypt(input)).toBe(input);
  });
});
