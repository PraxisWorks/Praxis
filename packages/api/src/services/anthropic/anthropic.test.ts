import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { createConsoleAnthropicAdapter } from "./console.js";
import { createRealAnthropicAdapter } from "./real.js";

describe("AnthropicAdapter", () => {
  describe("console adapter", () => {
    it("always returns valid", async () => {
      const adapter = createConsoleAnthropicAdapter();
      const result = await adapter.validateKey("sk-ant-test-key");
      expect(result).toEqual({ valid: true });
    });
  });

  describe("real adapter", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns valid for a 200 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = createRealAnthropicAdapter();
      const result = await adapter.validateKey("sk-ant-valid-key");

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        {
          method: "GET",
          headers: {
            "x-api-key": "sk-ant-valid-key",
            "anthropic-version": "2023-06-01",
          },
        },
      );
    });

    it("returns invalid for a 401 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = createRealAnthropicAdapter();
      const result = await adapter.validateKey("sk-ant-bad-key");

      expect(result).toEqual({
        valid: false,
        error: "Invalid or revoked API key",
      });
    });

    it("returns invalid with descriptive error on network failure", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Network unreachable"));
      vi.stubGlobal("fetch", mockFetch);

      const adapter = createRealAnthropicAdapter();
      const result = await adapter.validateKey("sk-ant-any-key");

      expect(result).toEqual({
        valid: false,
        error: "Network unreachable",
      });
    });
  });
});
