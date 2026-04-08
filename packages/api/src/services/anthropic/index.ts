import { getLogger } from "../../lib/logger.js";
import type { AnthropicAdapter } from "./types.js";
import { createConsoleAnthropicAdapter } from "./console.js";
import { createRealAnthropicAdapter } from "./real.js";

export type { AnthropicAdapter, ValidateKeyResult } from "./types.js";
export { createConsoleAnthropicAdapter } from "./console.js";
export { createRealAnthropicAdapter } from "./real.js";

let instance: AnthropicAdapter | null = null;

export function getAnthropicAdapter(): AnthropicAdapter {
  if (instance) return instance;

  const provider = process.env.ANTHROPIC_VALIDATION_PROVIDER;

  switch (provider) {
    case "real": {
      getLogger().info("Anthropic adapter: real");
      instance = createRealAnthropicAdapter();
      break;
    }

    default:
      getLogger().info(
        "Anthropic adapter: console (no ANTHROPIC_VALIDATION_PROVIDER set)",
      );
      instance = createConsoleAnthropicAdapter();
      break;
  }

  return instance;
}

export function setAnthropicAdapter(adapter: AnthropicAdapter): void {
  instance = adapter;
}

export function resetAnthropicAdapter(): void {
  instance = null;
}
