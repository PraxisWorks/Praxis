import { getLogger } from "../../lib/logger.js";
import type { AnthropicAdapter } from "./types.js";

export function createRealAnthropicAdapter(): AnthropicAdapter {
  return {
    async validateKey(key) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/models", {
          method: "GET",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
        });

        if (response.ok) {
          return { valid: true };
        }

        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: "Invalid or revoked API key" };
        }

        const message = `Anthropic API returned unexpected status ${response.status}`;
        getLogger().warn({ status: response.status }, message);
        return { valid: false, error: message };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown network error";
        getLogger().error({ err }, "Anthropic key validation failed");
        return { valid: false, error: message };
      }
    },
  };
}
