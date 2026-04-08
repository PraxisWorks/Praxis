import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../lib/env.js", () => ({
  getEnv: vi.fn(),
}));

import { getPushAdapter, resetPushAdapter } from "./index.js";
import { getEnv } from "../../lib/env.js";
import type { Env } from "../../lib/env.js";

/** Base env with all required fields; tests override specific values. */
const BASE_ENV: Env = {
  DATABASE_URL: "postgresql://mock",
  AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
  AUTH0_AUDIENCE: "https://api.example.com",
  PORT: "3001",
  CORS_ORIGIN: "http://localhost:3000",
  RATE_LIMIT_MAX: "100",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  UPLOAD_MAX_SIZE_MB: "10",
};

describe("getPushAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPushAdapter();
  });

  afterEach(() => {
    resetPushAdapter();
  });

  it("returns console adapter by default (no PUSH_PROVIDER)", () => {
    vi.mocked(getEnv).mockReturnValue({ ...BASE_ENV });

    const adapter = getPushAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.sendBatch).toBeTypeOf("function");
  });

  it("returns expo adapter when PUSH_PROVIDER=expo and EXPO_ACCESS_TOKEN set", () => {
    vi.mocked(getEnv).mockReturnValue({
      ...BASE_ENV,
      PUSH_PROVIDER: "expo",
      EXPO_ACCESS_TOKEN: "expo-token-123",
    });

    const adapter = getPushAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.sendBatch).toBeTypeOf("function");
  });

  it("throws when PUSH_PROVIDER=expo but no EXPO_ACCESS_TOKEN", () => {
    vi.mocked(getEnv).mockReturnValue({
      ...BASE_ENV,
      PUSH_PROVIDER: "expo",
    });

    expect(() => getPushAdapter()).toThrow(
      "PUSH_PROVIDER=expo requires EXPO_ACCESS_TOKEN",
    );
  });
});
