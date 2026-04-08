import { getLogger } from "../../lib/logger.js";
import type { AnthropicAdapter } from "./types.js";

export function createConsoleAnthropicAdapter(): AnthropicAdapter {
  return {
    async validateKey(key) {
      getLogger().info(
        { keyPrefix: key.slice(0, 8) },
        "Anthropic key validated (console adapter — not actually verified)",
      );
      return { valid: true };
    },
  };
}
