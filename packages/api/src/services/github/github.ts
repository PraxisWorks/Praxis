import { Octokit } from "@octokit/rest";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getLogger } from "../../lib/logger.js";
import type { GitHubAdapter } from "./types.js";

export function createGitHubAdapter(config: {
  token: string;
}): GitHubAdapter {
  const octokit = new Octokit({ auth: config.token });

  return {
    async registerWebhook(params) {
      try {
        const response = await octokit.repos.createWebhook({
          owner: params.owner,
          repo: params.repo,
          config: {
            url: params.url,
            secret: params.secret,
            content_type: "json",
          },
          events: params.events,
          active: true,
        });

        getLogger().info(
          { owner: params.owner, repo: params.repo, hookId: response.data.id },
          "GitHub webhook registered",
        );

        return { success: true, hookId: response.data.id };
      } catch (err) {
        const message = (err as Error).message;
        getLogger().error(
          { err, owner: params.owner, repo: params.repo },
          "Failed to register GitHub webhook",
        );
        return { success: false, error: message };
      }
    },

    async deleteWebhook(params) {
      try {
        await octokit.repos.deleteWebhook({
          owner: params.owner,
          repo: params.repo,
          hook_id: params.hookId,
        });

        getLogger().info(
          { owner: params.owner, repo: params.repo, hookId: params.hookId },
          "GitHub webhook deleted",
        );

        return { success: true };
      } catch (err) {
        const message = (err as Error).message;
        getLogger().error(
          { err, owner: params.owner, repo: params.repo, hookId: params.hookId },
          "Failed to delete GitHub webhook",
        );
        return { success: false, error: message };
      }
    },

    async listDeploymentStatuses(params) {
      try {
        const deployments = await octokit.repos.listDeployments({
          owner: params.owner,
          repo: params.repo,
          ref: params.ref,
          per_page: params.perPage ?? 10,
        });

        const statuses = await Promise.all(
          deployments.data.map(async (deployment) => {
            const statusResp =
              await octokit.repos.listDeploymentStatuses({
                owner: params.owner,
                repo: params.repo,
                deployment_id: deployment.id,
                per_page: 1,
              });

            const latest = statusResp.data[0];
            return {
              id: latest?.id ?? 0,
              deploymentId: deployment.id,
              state: latest?.state ?? "unknown",
              description: latest?.description ?? null,
              environment: deployment.environment,
              createdAt: latest?.created_at ?? deployment.created_at,
            };
          }),
        );

        return { success: true, statuses };
      } catch (err) {
        const message = (err as Error).message;
        getLogger().error(
          { err, owner: params.owner, repo: params.repo },
          "Failed to list deployment statuses",
        );
        return { success: false, error: message };
      }
    },

    async verifyWebhookSignature(params) {
      try {
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
      } catch (err) {
        const message = (err as Error).message;
        getLogger().error({ err }, "Failed to verify webhook signature");
        return { valid: false, error: message };
      }
    },
  };
}
