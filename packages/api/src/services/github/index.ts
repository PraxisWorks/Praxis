import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { GitHubAdapter } from "./types.js";
import { createGitHubAdapter } from "./github.js";

export type {
  GitHubAdapter,
  RegisterWebhookParams,
  RegisterWebhookResult,
  DeleteWebhookParams,
  DeleteWebhookResult,
  VerifyWebhookSignatureParams,
  VerifyWebhookSignatureResult,
  ListDeploymentStatusesParams,
  ListDeploymentStatusesResult,
  DeploymentStatus,
} from "./types.js";

let instance: GitHubAdapter | null = null;
let resolved = false;

/**
 * Returns the GitHub adapter, or null if GITHUB_TOKEN is not set.
 * Callers must handle the null case — never silently fake GitHub operations.
 */
export function getGitHubAdapter(): GitHubAdapter | null {
  if (resolved) return instance;

  const env = getEnv();

  if (env.GITHUB_TOKEN) {
    getLogger().info("GitHub adapter: Octokit");
    instance = createGitHubAdapter({ token: env.GITHUB_TOKEN });
  } else {
    getLogger().warn("GitHub adapter: disabled (no GITHUB_TOKEN set)");
    instance = null;
  }

  resolved = true;
  return instance;
}

export function setGitHubAdapter(adapter: GitHubAdapter | null): void {
  instance = adapter;
  resolved = true;
}

export function resetGitHubAdapter(): void {
  instance = null;
  resolved = false;
}
