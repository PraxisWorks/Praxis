import { createHmac, timingSafeEqual } from "node:crypto";
import { getLogger } from "../../lib/logger.js";
import type { GitHubAdapter } from "./types.js";

let nextHookId = 1000;

export function createConsoleGitHubAdapter(): GitHubAdapter {
  return {
    async registerWebhook(params) {
      const hookId = nextHookId++;
      getLogger().info(
        { owner: params.owner, repo: params.repo, hookId, url: params.url },
        "GitHub webhook registered (console adapter — not actually created)",
      );
      return { success: true, hookId };
    },

    async deleteWebhook(params) {
      getLogger().info(
        { owner: params.owner, repo: params.repo, hookId: params.hookId },
        "GitHub webhook deleted (console adapter — not actually deleted)",
      );
      return { success: true };
    },

    async listDeploymentStatuses(params) {
      getLogger().info(
        { owner: params.owner, repo: params.repo, ref: params.ref },
        "Deployment statuses listed (console adapter — returning empty list)",
      );
      return { success: true, statuses: [] };
    },

    async verifyWebhookSignature(params) {
      const hmac = createHmac("sha256", params.secret);
      hmac.update(params.payload);
      const expected = `sha256=${hmac.digest("hex")}`;

      const expectedBuf = Buffer.from(expected, "utf8");
      const signatureBuf = Buffer.from(params.signature, "utf8");

      if (expectedBuf.length !== signatureBuf.length) {
        return { valid: false, error: "Signature length mismatch" };
      }

      const valid = timingSafeEqual(expectedBuf, signatureBuf);
      return { valid };
    },
  };
}
